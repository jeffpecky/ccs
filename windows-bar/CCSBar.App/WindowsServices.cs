using System.Diagnostics;
using System.Net.Http;
using System.IO;
using System.Text.Json;
using System.Windows.Forms;
using CCSBar.Core;

namespace CCSBar.App;

public sealed record ProcessCommand(string FileName, IReadOnlyList<string> Arguments, bool UseShellExecute = false, bool CreateNoWindow = false, string? WorkingDirectory = null, IReadOnlyDictionary<string, string>? Environment = null);

public static class WindowsProcess
{
    public static Process? Start(ProcessCommand command)
    {
        var info = new ProcessStartInfo(command.FileName) { UseShellExecute = command.UseShellExecute, CreateNoWindow = command.CreateNoWindow, WorkingDirectory = command.WorkingDirectory ?? "" };
        foreach (var argument in command.Arguments) info.ArgumentList.Add(argument);
        if (command.Environment is not null) foreach (var pair in command.Environment) info.Environment[pair.Key] = pair.Value;
        return Process.Start(info) ?? throw new InvalidOperationException($"Process did not start: {command.FileName}");
    }
}

public sealed class DashboardLauncher(Func<ProcessCommand, Process?> start)
{
    public void Open(Uri activeBaseUrl) { using var process = start(new(activeBaseUrl.AbsoluteUri, [], UseShellExecute: true)); }
}

public sealed class WindowsBarUpdater(Func<ProcessCommand, Process?> start)
{
    public void Install() { using var process = start(new("cmd.exe", ["/d", "/s", "/c", "ccs", "bar", "install", "--launch", "--await-quit"], CreateNoWindow: true)); }
}

public interface IWindowsPathSecurity
{
    bool FileExists(string path); bool DirectoryExists(string path); bool IsReparsePoint(string path); bool IsSafeExecutable(string path); string Canonicalize(string path);
}

public sealed class WindowsPathSecurity : IWindowsPathSecurity
{
    public bool FileExists(string path) => File.Exists(path);
    public bool DirectoryExists(string path) => Directory.Exists(path);
    public bool IsReparsePoint(string path) => (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0;
    public bool IsSafeExecutable(string path)
    {
        if (!FileExists(path) || IsReparsePoint(path) || !path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) return false;
        try { return System.Security.Cryptography.X509Certificates.X509Certificate.CreateFromSignedFile(path) is not null; }
        catch (System.Security.Cryptography.CryptographicException) { return IsUserPrivate(path); }
    }
    static bool IsUserPrivate(string path)
    {
        var acl = new FileInfo(path).GetAccessControl(); var owner = acl.GetOwner(typeof(System.Security.Principal.SecurityIdentifier));
        var current = System.Security.Principal.WindowsIdentity.GetCurrent().User;
        if (current is null || owner is null || !owner.Equals(current)) return false;
        var broad = new[] { "S-1-1-0", "S-1-5-11", "S-1-5-32-545" };
        return !acl.GetAccessRules(true, true, typeof(System.Security.Principal.SecurityIdentifier)).Cast<System.Security.AccessControl.FileSystemAccessRule>().Any(rule => rule.AccessControlType == System.Security.AccessControl.AccessControlType.Allow && broad.Contains(((System.Security.Principal.SecurityIdentifier)rule.IdentityReference).Value) && (rule.FileSystemRights & (System.Security.AccessControl.FileSystemRights.Write | System.Security.AccessControl.FileSystemRights.Modify | System.Security.AccessControl.FileSystemRights.FullControl)) != 0);
    }
    public string Canonicalize(string path) => Path.GetFullPath(path);
}

public sealed class WindowsLaunchTrust(IWindowsPathSecurity paths, string privateShim) : ILaunchTrustValidator
{
    readonly string shim = paths.Canonicalize(privateShim);
    public bool IsTrustedFile(string path)
    {
        if (!paths.FileExists(path) || HasReparseInPath(path)) return false;
        var canonical = paths.Canonicalize(path);
        if (canonical.Equals(shim, StringComparison.OrdinalIgnoreCase)) return true;
        var name = Path.GetFileName(canonical);
        return name is "node.exe" or "bun.exe" && paths.IsSafeExecutable(canonical);
    }
    public bool IsTrustedDirectory(string path) => paths.DirectoryExists(path) && !HasReparseInPath(path);
    bool HasReparseInPath(string path)
    {
        var current = paths.Canonicalize(path);
        while (!string.IsNullOrEmpty(current))
        {
            if ((paths.FileExists(current) || paths.DirectoryExists(current)) && paths.IsReparsePoint(current)) return true;
            var parent = Path.GetDirectoryName(current); if (parent == current) break; current = parent ?? "";
        }
        return false;
    }
}

sealed class WindowsBarConnector : IBarConnector, IActiveBarConnection
{
    readonly HttpClient http = new(); readonly SemaphoreSlim connectGate = new(1, 1); readonly Func<ProcessCommand, Process?> start; readonly string home; Uri? activeBaseUrl; string? diagnostics;
    public WindowsBarConnector(Func<ProcessCommand, Process?>? start = null, string? home = null) { this.start = start ?? WindowsProcess.Start; this.home = home ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile); }
    public Uri? ActiveBaseUrl => activeBaseUrl;
    public string? Diagnostics => diagnostics;
    public async Task<IBarDataClient?> ConnectAsync(bool launch, CancellationToken ct)
    {
        await connectGate.WaitAsync(ct);
        try
        {
            var token = BarServerProbe.LoadAuthToken(home); var uri = token is null ? null : await new BarServerProbe(http, token, home: home).FindLiveServerAsync(BarDiscovery.Load(home).Value, ct);
            if (uri is null && launch)
            {
                StartServer();
                for (var i = 0; i < 12 && uri is null; i++) { await Task.Delay(500, ct); token ??= BarServerProbe.LoadAuthToken(home); if (token is not null) uri = await new BarServerProbe(http, token, home: home).FindLiveServerAsync(BarDiscovery.Load(home).Value, ct); }
            }
            activeBaseUrl = uri;
            return uri is null || token is null ? null : new CCSBarClient(uri, http, token);
        }
        finally { connectGate.Release(); }
    }
    void StartServer()
    {
        var shim = Path.Combine(home, "AppData", "Local", "CCS Bar", "launcher", "ccs.js"); var descriptor = BarLaunchDescriptor.Load(home, new WindowsLaunchTrust(new WindowsPathSecurity(), shim));
        try
        {
            if (descriptor is null) throw new InvalidOperationException("Trusted CCS Bar launch descriptor unavailable. Run `ccs bar launch` to regenerate it.");
            var command = new ProcessCommand(descriptor.Runtime, descriptor.Args, CreateNoWindow: true, WorkingDirectory: descriptor.Home, Environment: descriptor.CcsHome is null ? null : new Dictionary<string, string> { ["CCS_HOME"] = descriptor.CcsHome });
            start(command); diagnostics = $"Started: {command.FileName} {string.Join(' ', command.Arguments)}";
        }
        catch (Exception e) { diagnostics = $"Failed to start CCS: {e.Message}. Check {Path.Combine(BarServerProbe.CcsHome(home), "bar", "serve.log")}"; throw new InvalidOperationException(diagnostics, e); }
    }
}

sealed class WindowsBarNotifier(NotifyIcon tray, Action<Action> dispatch) : IBarNotifier
{
    public void Deliver(IReadOnlyList<BarNotification> notifications)
    {
        if (notifications.Count == 0) return; dispatch(() => { foreach (var notification in notifications) tray.ShowBalloonTip(5000, notification.Title, notification.Body, notification.Kind == BarAlertKind.ReauthNeeded ? ToolTipIcon.Error : ToolTipIcon.Warning); });
    }
}

sealed class JsonBarSettings : IBarSettings
{
    readonly string path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CCSBar", "settings.json"); readonly object gate = new(); SettingsDocument document;
    public JsonBarSettings() { try { document = JsonSerializer.Deserialize<SettingsDocument>(File.ReadAllText(path), BarJson.Options) ?? new(); } catch { document = new(); } }
    public BarUiSettings Ui { get { lock (gate) return document.UiValue ?? new(); } set { lock (gate) document = document with { UiValue = value }; } }
    public BarPreferences Alerts { get { lock (gate) return document.AlertsValue ?? new(); } set { lock (gate) document = document with { AlertsValue = value }; } }
    public IReadOnlySet<string> FiredKeys { get { lock (gate) return (document.FiredKeysValue ?? []).ToHashSet(StringComparer.Ordinal); } set { lock (gate) document = document with { FiredKeysValue = value.ToArray() }; } }
    public void Save() { lock (gate) { Directory.CreateDirectory(Path.GetDirectoryName(path)!); var temp = path + $".{Environment.ProcessId}.tmp"; File.WriteAllText(temp, JsonSerializer.Serialize(document, BarJson.Options)); File.Move(temp, path, true); } }
    sealed record SettingsDocument(BarUiSettings? UiValue = null, BarPreferences? AlertsValue = null, string[]? FiredKeysValue = null);
}
