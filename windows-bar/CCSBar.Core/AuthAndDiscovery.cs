using System.Net;
using System.Text.Json;

namespace CCSBar.Core;

public enum BarDiscoveryState { Ready, Missing, Unreadable, Malformed, Unsafe }
public sealed record BarDiscoveryLoadResult(BarDiscoveryState State, BarDiscovery? Value = null, string? Path = null);
public sealed record BarDiscovery(string BaseUrl, int Port, string AuthMode)
{
    public Uri? ResolvedUri => IsSafe(out var uri) ? uri : null;
    public static string DefaultPath(string home, IReadOnlyDictionary<string, string?>? environment = null) => Path.Combine(BarServerProbe.CcsHome(home, environment), "bar.json");
    public static BarDiscoveryLoadResult Load(string home, IReadOnlyDictionary<string, string?>? environment = null)
    {
        var path = DefaultPath(home, environment);
        if (!File.Exists(path)) return new(BarDiscoveryState.Missing, Path: path);
        string json;
        try { json = File.ReadAllText(path); }
        catch (IOException) { return new(BarDiscoveryState.Unreadable, Path: path); }
        catch (UnauthorizedAccessException) { return new(BarDiscoveryState.Unreadable, Path: path); }
        BarDiscovery? value;
        try { value = JsonSerializer.Deserialize<BarDiscovery>(json, BarJson.Options); }
        catch (JsonException) { return new(BarDiscoveryState.Malformed, Path: path); }
        return value is null ? new(BarDiscoveryState.Malformed, Path: path) : value.IsSafe(out _) ? new(BarDiscoveryState.Ready, value, path) : new(BarDiscoveryState.Unsafe, Path: path);
    }
    public bool IsSafe(out Uri? uri)
    {
        uri = null;
        if (AuthMode != "loopback" || Port is < 1 or > 65535 || !Uri.TryCreate(BaseUrl, UriKind.Absolute, out var parsed) || parsed.Scheme != Uri.UriSchemeHttp || parsed.Port != Port || !IPAddress.TryParse(parsed.Host, out var address) || (!address.Equals(IPAddress.Loopback) && !address.Equals(IPAddress.IPv6Loopback)) || parsed.AbsolutePath != "/" || !string.IsNullOrEmpty(parsed.Query) || !string.IsNullOrEmpty(parsed.Fragment)) return false;
        uri = parsed;
        return true;
    }
}

public sealed record BarProbeResult(BarConnectionState State, Uri? BaseUri = null);

public interface ILaunchTrustValidator
{
    bool IsTrustedFile(string path);
    bool IsTrustedDirectory(string path);
}

public sealed record BarLaunchDescriptor(int Schema, string Runtime, IReadOnlyList<string> Args, string Home, string? CcsHome)
{
    public static string DefaultPath(string home, IReadOnlyDictionary<string, string?>? environment = null) => Path.Combine(BarServerProbe.CcsHome(home, environment), "bar", "launch.json");
    public static BarLaunchDescriptor? Load(string home, ILaunchTrustValidator trust, IReadOnlyDictionary<string, string?>? environment = null)
    {
        var path = DefaultPath(home, environment);
        try { var value = JsonSerializer.Deserialize<BarLaunchDescriptor>(File.ReadAllText(path), BarJson.Options); return value?.IsSafe(home, trust) == true ? value : null; }
        catch (JsonException) { return null; } catch (IOException) { return null; } catch (UnauthorizedAccessException) { return null; }
    }
    public bool IsSafe(string expectedHome, ILaunchTrustValidator trust)
    {
        if (Schema != 1 || Args is null || Args.Count != 3 || Args[1] != "bar" || Args[2] != "serve") return false;
        if (!Path.IsPathFullyQualified(Runtime) || !Path.IsPathFullyQualified(Args[0]) || !Path.IsPathFullyQualified(Home) || !Path.GetFullPath(Home).Equals(Path.GetFullPath(expectedHome), StringComparison.OrdinalIgnoreCase) || CcsHome is not null && (!Path.IsPathFullyQualified(CcsHome) || CcsHome.Length == 0)) return false;
        var expectedShim = Path.Combine(expectedHome, "AppData", "Local", "CCS Bar", "launcher", "ccs.js");
        if (Path.GetFileName(Runtime).ToLowerInvariant() is not ("node.exe" or "bun.exe") || !Path.GetFullPath(Args[0]).Equals(Path.GetFullPath(expectedShim), StringComparison.OrdinalIgnoreCase)) return false;
        return trust.IsTrustedFile(Runtime) && trust.IsTrustedFile(Args[0]) && trust.IsTrustedDirectory(Home) && (CcsHome is null || trust.IsTrustedDirectory(CcsHome));
    }
}

public sealed class BarServerProbe
{
    public static readonly int[] FallbackPorts = [3000, 3001, 3002, 8000, 8080];
    readonly HttpClient http; readonly TimeSpan probeTimeout;
    public BarServerProbe(HttpClient http, TimeSpan? probeTimeout = null)
    { this.http = http; this.probeTimeout = probeTimeout ?? TimeSpan.FromSeconds(1.5); }
    public static string CcsHome(string home, IReadOnlyDictionary<string, string?>? environment = null)
    {
        var value = environment is null ? Environment.GetEnvironmentVariable("CCS_HOME") : environment.TryGetValue("CCS_HOME", out var configured) ? configured : null;
        return !string.IsNullOrWhiteSpace(value) ? value : Path.Combine(home, ".ccs");
    }
    public async Task<Uri?> FindLiveServerAsync(BarDiscovery? discovery, CancellationToken cancellationToken = default)
        => (await ProbeAsync(discovery, cancellationToken)).BaseUri;
    public async Task<BarProbeResult> ProbeAsync(BarDiscovery? discovery, CancellationToken cancellationToken = default)
    {
        var failures = new List<BarConnectionState>();
        if (discovery?.ResolvedUri is { } discovered)
        {
            var result = await ProbeOneAsync(discovered, cancellationToken);
            if (result == BarConnectionState.Ready) return new(result, discovered);
            failures.Add(result);
        }
        var candidates = FallbackPorts.Where(port => port != discovery?.Port).SelectMany(port => new[] { new Uri($"http://127.0.0.1:{port}"), new Uri($"http://[::1]:{port}") }).ToArray();
        using var found = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken); using var gate = new SemaphoreSlim(4);
        var tasks = candidates.Select(async uri => { await gate.WaitAsync(found.Token); try { return (Uri: uri, State: await ProbeOneAsync(uri, found.Token)); } catch (OperationCanceledException) when (found.IsCancellationRequested && !cancellationToken.IsCancellationRequested) { return (Uri: uri, State: BarConnectionState.Unreachable); } finally { gate.Release(); } }).ToArray();
        while (tasks.Length > 0) { var complete = await Task.WhenAny(tasks); tasks = tasks.Where(task => task != complete).ToArray(); var result = await complete; if (result.State == BarConnectionState.Ready) { found.Cancel(); return new(result.State, result.Uri); } failures.Add(result.State); }
        return new(failures.Contains(BarConnectionState.ApiFailure) ? BarConnectionState.ApiFailure : failures.Contains(BarConnectionState.Timeout) ? BarConnectionState.Timeout : BarConnectionState.Unreachable);
    }
    async Task<BarConnectionState> ProbeOneAsync(Uri baseUri, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(probeTimeout);
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(baseUri, "api/bar/summary"));
        request.Options.Set(new HttpRequestOptionsKey<TimeSpan>("CCSBar.Timeout"), probeTimeout);
        try
        {
            using var response = await http.SendAsync(request, timeout.Token);
            return response.StatusCode == HttpStatusCode.OK ? BarConnectionState.Ready : BarConnectionState.ApiFailure;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return BarConnectionState.Timeout; }
        catch (HttpRequestException) { return BarConnectionState.Unreachable; }
    }
}
