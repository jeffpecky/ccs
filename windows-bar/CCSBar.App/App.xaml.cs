using System.Drawing;
using System.Reflection;
using System.Net.Http;
using System.Windows;
using System.Windows.Forms;
using System.Windows.Media.Imaging;
using CCSBar.Core;

namespace CCSBar.App;

public partial class App : System.Windows.Application
{
    const string InstanceName = "Local\\CCSBar.Windows.Instance"; Mutex? mutex; EventWaitHandle? activateEvent; NotifyIcon? tray; MainWindow? panel; BarViewModel? viewModel; JsonBarSettings? settings;
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e); mutex = new(true, InstanceName, out var owner);
        if (!owner) { try { EventWaitHandle.OpenExisting(InstanceName + ".Activate").Set(); } catch { } Shutdown(); return; }
        activateEvent = new(false, EventResetMode.AutoReset, InstanceName + ".Activate");
        settings = new(); viewModel = new(new WindowsBarConnector(), settings, updateChecker: ct => BarUpdate.FetchLatestPublishedVersionAsync(new HttpClient(), ct), currentVersion: VersionText.Value);
        panel = new(viewModel, settings); ApplyTheme(settings.Ui.Appearance);
        tray = new NotifyIcon { Visible = true, Text = "CCS Bar", Icon = LoadTrayIcon(settings.Ui.IconStyle) };
        tray.MouseClick += (_, args) => { if (args.Button == MouseButtons.Left) TogglePanel(); };
        tray.ContextMenuStrip = new ContextMenuStrip(); tray.ContextMenuStrip.Items.Add("Open", null, (_, _) => ShowPanel()); tray.ContextMenuStrip.Items.Add("Quit", null, (_, _) => Exit());
        viewModel.PropertyChanged += (_, args) => { if (args.PropertyName == nameof(BarViewModel.StatusTitle)) Dispatcher.Invoke(UpdateTray); };
        _ = Task.Run(() => { while (activateEvent.WaitOne()) Dispatcher.Invoke(ShowPanel); });
        viewModel.StartPolling(); _ = viewModel.ReconnectAndLoadAsync(false); if (settings.Ui.AutoCheckUpdates) _ = viewModel.CheckForUpdatesAsync();
    }
    public void TogglePanel() { if (panel?.IsVisible == true) panel.Hide(); else ShowPanel(); }
    public void ShowPanel() { if (panel is null || tray is null) return; panel.ShowAnchored(System.Windows.Forms.Cursor.Position); panel.Activate(); _ = viewModel?.OnPanelOpenedAsync(); }
    public void SettingsChanged() { if (settings is null || tray is null) return; ApplyTheme(settings.Ui.Appearance); tray.Icon?.Dispose(); tray.Icon = LoadTrayIcon(settings.Ui.IconStyle); panel?.Render(); UpdateTray(); }
    void UpdateTray() { if (tray is not null && viewModel is not null) tray.Text = viewModel.StatusTitle[..Math.Min(63, viewModel.StatusTitle.Length)]; }
    public new void Exit() { tray?.Dispose(); viewModel?.Dispose(); activateEvent?.Dispose(); mutex?.ReleaseMutex(); mutex?.Dispose(); Shutdown(); }
    static Icon LoadTrayIcon(BarIconStyle style)
    {
        var name = style == BarIconStyle.Color ? "MenuBarColor.png" : "MenuBarTemplate.png";
        var stream = GetResourceStream(new Uri($"pack://application:,,,/Assets/{name}"))!.Stream;
        using var bitmap = new Bitmap(stream); using var icon = Icon.FromHandle(bitmap.GetHicon()); return (Icon)icon.Clone();
    }
    public static void ApplyTheme(BarAppearance appearance)
    {
        var glass = SystemParameters.WindowGlassColor; var dark = appearance == BarAppearance.Dark || appearance == BarAppearance.System && (glass.R * .299 + glass.G * .587 + glass.B * .114) < 128;
        var p = dark ? BarThemePalette.Dark : BarThemePalette.Light; var resources = Current.Resources;
        resources["WindowBrush"] = Brush(p.WindowSurface); resources["TextBrush"] = Brush(dark ? "#F2F2F2" : "#1D1D1F"); resources["MutedBrush"] = Brush(dark ? "#A8A8AC" : "#68686C"); resources["BorderBrush"] = Brush(dark ? "#404044" : "#D7D7DB"); resources["CardBrush"] = Brush(dark ? "#2B2C2F" : "#EAEAED"); resources["TrackBrush"] = Brush(dark ? "#45464A" : "#D6D6DA"); resources["AccentBrush"] = Brush(p.Accent); resources["SubscriptionBrush"] = Brush(p.Subscription); resources["GreenBrush"] = Brush(p.Green); resources["AmberBrush"] = Brush(p.Amber); resources["CoralBrush"] = Brush(p.Coral); resources["RedBrush"] = Brush(p.Red);
    }
    static System.Windows.Media.Brush Brush(string value) => (System.Windows.Media.Brush)new System.Windows.Media.BrushConverter().ConvertFromString(value)!;
}

static class VersionText { public static string Value => Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0"; }
