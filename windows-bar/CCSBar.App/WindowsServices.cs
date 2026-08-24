using System.Diagnostics;
using System.Net.Http;
using System.IO;
using System.Text.Json;
using CCSBar.Core;

namespace CCSBar.App;

sealed class WindowsBarConnector : IBarConnector
{
    readonly HttpClient http = new();
    public async Task<IBarDataClient?> ConnectAsync(CancellationToken ct)
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile); var token = BarServerProbe.LoadAuthToken(home); if (token is null) { StartServer(home); await Task.Delay(500, ct); token = BarServerProbe.LoadAuthToken(home); }
        var probe = new BarServerProbe(http, token, home: home); var discovery = BarDiscovery.Load(home).Value; var uri = await probe.FindLiveServerAsync(discovery, ct);
        if (uri is null) { StartServer(home); for (var i = 0; i < 12 && uri is null; i++) { await Task.Delay(500, ct); token ??= BarServerProbe.LoadAuthToken(home); if (token is not null) uri = await new BarServerProbe(http, token, home: home).FindLiveServerAsync(BarDiscovery.Load(home).Value, ct); } }
        return uri is null || token is null ? null : new CCSBarClient(uri, http, token);
    }
    static void StartServer(string home)
    {
        var descriptor = BarLaunchDescriptor.Load(home, new ExistingPathTrust());
        try
        {
            ProcessStartInfo info;
            if (descriptor is not null) { info = new(descriptor.Runtime) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = descriptor.Home }; foreach (var arg in descriptor.Args) info.ArgumentList.Add(arg); if (descriptor.CcsHome is not null) info.Environment["CCS_HOME"] = descriptor.CcsHome; }
            else info = new("ccs", "bar serve") { UseShellExecute = false, CreateNoWindow = true };
            Process.Start(info);
        } catch { }
    }
    sealed class ExistingPathTrust : ILaunchTrustValidator { public bool IsTrustedFile(string path) => File.Exists(path); public bool IsTrustedDirectory(string path) => Directory.Exists(path); }
}

sealed class JsonBarSettings : IBarSettings
{
    readonly string path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CCSBar", "settings.json"); SettingsDocument document;
    public JsonBarSettings() { try { document = JsonSerializer.Deserialize<SettingsDocument>(File.ReadAllText(path), BarJson.Options) ?? new(); } catch { document = new(); } }
    public BarUiSettings Ui { get => document.UiValue ?? new(); set => document = document with { UiValue = value }; }
    public BarPreferences Alerts { get => document.AlertsValue ?? new(); set => document = document with { AlertsValue = value }; }
    public IReadOnlySet<string> FiredKeys { get => (document.FiredKeysValue ?? []).ToHashSet(StringComparer.Ordinal); set => document = document with { FiredKeysValue = value.ToArray() }; }
    public void Save() { Directory.CreateDirectory(Path.GetDirectoryName(path)!); var temp = path + ".tmp"; File.WriteAllText(temp, JsonSerializer.Serialize(document, BarJson.Options)); File.Move(temp, path, true); }
    sealed record SettingsDocument(BarUiSettings? UiValue = null, BarPreferences? AlertsValue = null, string[]? FiredKeysValue = null);
}
