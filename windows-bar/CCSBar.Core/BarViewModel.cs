using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace CCSBar.Core;

public enum BarAppearance { System, Light, Dark }
public enum BarIconStyle { Template, Color }
public enum SpendChartStyle { Bars, Line }
public enum SpendPeriod { Today, Last7d, Last30d }

public sealed record BarUiSettings(
    BarAppearance Appearance = BarAppearance.Dark,
    BarIconStyle IconStyle = BarIconStyle.Template,
    BarGlanceMode GlanceMode = BarGlanceMode.Auto,
    SpendChartStyle ChartStyle = SpendChartStyle.Bars,
    SpendPeriod SpendPeriod = SpendPeriod.Last7d,
    bool AlertsExpanded = false,
    bool AutoCheckUpdates = true);

public interface IBarClock { DateTimeOffset Now { get; } }
public sealed class SystemBarClock : IBarClock { public DateTimeOffset Now => DateTimeOffset.Now; }
public interface IBarSettings { BarUiSettings Ui { get; set; } BarPreferences Alerts { get; set; } IReadOnlySet<string> FiredKeys { get; set; } void Save(); }
public interface IBarConnector { Task<IBarDataClient?> ConnectAsync(CancellationToken cancellationToken); }
public interface IBarDataClient
{
    Task<IReadOnlyList<BarSummaryRow>> SummaryAsync(bool force, CancellationToken ct);
    Task<BarAnalytics?> AnalyticsAsync(CancellationToken ct);
    Task PauseAsync(BarSummaryRow row, CancellationToken ct); Task ResumeAsync(BarSummaryRow row, CancellationToken ct);
    Task SoloAsync(BarSummaryRow row, CancellationToken ct); Task SetDefaultAsync(BarSummaryRow row, CancellationToken ct);
    Task TierLockAsync(BarSummaryRow row, string? tier, CancellationToken ct);
}

public sealed class ProfileCarousel
{
    readonly IReadOnlyList<BarSummaryRow> rows; int index;
    public ProfileCarousel(IEnumerable<BarSummaryRow> source)
    {
        rows = source.OrderByDescending(x => x.IsDefault || BarRows.IsBaseAccount(x)).ThenBy(x => x.Id, StringComparer.Ordinal).ToArray();
    }
    public BarSummaryRow Selected => rows[index];
    public int Count => rows.Count;
    public void Move(int delta) { if (rows.Count > 0) index = (index + delta % rows.Count + rows.Count) % rows.Count; }
}

public sealed class BarViewModel : INotifyPropertyChanged, IDisposable
{
    readonly IBarConnector connector; readonly IBarSettings settings; readonly IBarClock clock;
    readonly Func<CancellationToken, Task<string?>> updateChecker; readonly string currentVersion;
    IBarDataClient? client; DateTimeOffset? lastOpenRefresh; CancellationTokenSource? polling;
    IReadOnlyList<BarSummaryRow> rows = []; BarAnalytics? analytics; bool offline; bool starting; bool refreshing;
    bool summaryStale; bool analyticsStale; string? lastError; IReadOnlyList<BarNotification> activeAlerts = [];
    bool updateAvailable; string? latestVersion; bool installingUpdate;

    public BarViewModel(IBarConnector connector, IBarSettings settings, IBarClock? clock = null,
        Func<CancellationToken, Task<string?>>? updateChecker = null, string currentVersion = "0.0.0")
    { this.connector = connector; this.settings = settings; this.clock = clock ?? new SystemBarClock(); this.updateChecker = updateChecker ?? (_ => Task.FromResult<string?>(null)); this.currentVersion = currentVersion; }
    public event PropertyChangedEventHandler? PropertyChanged;
    public IReadOnlyList<BarSummaryRow> Rows { get => rows; private set => Set(ref rows, value); }
    public BarAnalytics? Analytics { get => analytics; private set => Set(ref analytics, value); }
    public bool Offline { get => offline; private set => Set(ref offline, value); }
    public bool IsStarting { get => starting; private set => Set(ref starting, value); }
    public bool IsRefreshing { get => refreshing; private set => Set(ref refreshing, value); }
    public bool SummaryStale { get => summaryStale; private set => Set(ref summaryStale, value); }
    public bool AnalyticsStale { get => analyticsStale; private set => Set(ref analyticsStale, value); }
    public string? LastError { get => lastError; private set => Set(ref lastError, value); }
    public IReadOnlyList<BarNotification> ActiveAlerts { get => activeAlerts; private set => Set(ref activeAlerts, value); }
    public bool UpdateAvailable { get => updateAvailable; private set => Set(ref updateAvailable, value); }
    public string? LatestVersion { get => latestVersion; private set => Set(ref latestVersion, value); }
    public bool IsInstallingUpdate { get => installingUpdate; set => Set(ref installingUpdate, value); }
    public BarUiSettings Ui { get => settings.Ui; set { settings.Ui = value; settings.Save(); Changed(); Changed(nameof(StatusTitle)); } }
    public BarPreferences AlertPreferences { get => settings.Alerts; set { settings.Alerts = value; settings.Save(); EvaluateAlerts(); } }
    public string StatusTitle => Offline ? "CCS offline" : BarFormatting.StatusTitle(Rows, Analytics, Ui.GlanceMode);

    public async Task ReconnectAndLoadAsync(bool force, CancellationToken ct = default)
    {
        IsStarting = client is null; LastError = null;
        try { client = await connector.ConnectAsync(ct); }
        catch (Exception e) when (e is not OperationCanceledException) { LastError = e.Message; client = null; }
        IsStarting = false;
        if (client is null) { Offline = Rows.Count == 0; return; }
        await LoadAsync(force, ct);
    }
    public async Task LoadAsync(bool force, CancellationToken ct = default)
    {
        if (client is null) { Offline = Rows.Count == 0; return; }
        IsRefreshing = force;
        var summary = Capture(() => client.SummaryAsync(force, ct));
        var analysis = Capture(() => client.AnalyticsAsync(ct));
        await Task.WhenAll(summary, analysis);
        if (summary.Result.Value is { } loadedRows) { Rows = loadedRows; SummaryStale = false; } else SummaryStale = Rows.Count > 0;
        if (analysis.Result.Value is { } loadedAnalytics) { Analytics = loadedAnalytics; AnalyticsStale = false; } else AnalyticsStale = Analytics is not null;
        LastError = summary.Result.Error?.Message ?? analysis.Result.Error?.Message;
        Offline = Rows.Count == 0 && summary.Result.Error is not null;
        IsRefreshing = false; EvaluateAlerts(); Changed(nameof(StatusTitle));
    }
    public Task RetryAsync(CancellationToken ct = default) => ReconnectAndLoadAsync(true, ct);
    public Task ForceRefreshAsync(CancellationToken ct = default) => ReconnectAndLoadAsync(true, ct);
    public Task OnPanelOpenedAsync(CancellationToken ct = default)
    {
        if (lastOpenRefresh is not null && clock.Now - lastOpenRefresh < TimeSpan.FromSeconds(15)) return Task.CompletedTask;
        lastOpenRefresh = clock.Now; return ReconnectAndLoadAsync(true, ct);
    }
    public void StartPolling()
    {
        polling?.Cancel(); polling = new(); var ct = polling.Token;
        _ = Task.Run(async () => { using var timer = new PeriodicTimer(TimeSpan.FromSeconds(60)); while (await timer.WaitForNextTickAsync(ct)) await ReconnectAndLoadAsync(false, ct); }, ct);
    }
    public async Task CheckForUpdatesAsync(CancellationToken ct = default)
    { var latest = await updateChecker(ct); LatestVersion = latest; UpdateAvailable = latest is not null && BarUpdate.IsNewer(latest, currentVersion); }
    public Task PauseAsync(BarSummaryRow row, CancellationToken ct = default) => ActionAsync(c => c.PauseAsync(row, ct), ct);
    public Task ResumeAsync(BarSummaryRow row, CancellationToken ct = default) => ActionAsync(c => c.ResumeAsync(row, ct), ct);
    public Task SoloAsync(BarSummaryRow row, CancellationToken ct = default) => ActionAsync(c => c.SoloAsync(row, ct), ct);
    public Task SetDefaultAsync(BarSummaryRow row, CancellationToken ct = default) => ActionAsync(c => c.SetDefaultAsync(row, ct), ct);
    public Task TierLockAsync(BarSummaryRow row, string? tier, CancellationToken ct = default) => ActionAsync(c => c.TierLockAsync(row, tier, ct), ct);
    async Task ActionAsync(Func<IBarDataClient, Task> action, CancellationToken ct) { if (client is null) return; try { await action(client); await LoadAsync(true, ct); } catch (Exception e) when (e is not OperationCanceledException) { LastError = e.Message; } }
    void EvaluateAlerts() { var result = BarAlertEngine.Evaluate(Rows, Analytics, settings.Alerts, settings.FiredKeys, clock.Now); ActiveAlerts = result.ToDeliver; settings.FiredKeys = result.FiredKeys; settings.Save(); }
    static async Task<(T? Value, Exception? Error)> Capture<T>(Func<Task<T>> operation) { try { return (await operation(), null); } catch (Exception e) when (e is not OperationCanceledException) { return (default, e); } }
    void Set<T>(ref T field, T value, [CallerMemberName] string? name = null) { if (EqualityComparer<T>.Default.Equals(field, value)) return; field = value; Changed(name); }
    void Changed([CallerMemberName] string? name = null) => PropertyChanged?.Invoke(this, new(name));
    public void Dispose() { polling?.Cancel(); polling?.Dispose(); }
}
