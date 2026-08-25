using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace CCSBar.Core;

public static class BarAuth
{
    public const string NonceHeader = "x-ccs-bar-nonce";
    public const string TokenHeader = "x-ccs-bar-token";
    public static string NormalizePath(string value) { var uri = new Uri(new Uri("http://localhost"), value); var pairs = uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries).Order(StringComparer.Ordinal).ToArray(); return uri.AbsolutePath + (pairs.Length > 0 ? "?" + string.Join('&', pairs) : ""); }
    public static string Proof(string token, string direction, string method, string path, string nonce) => Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(token), Encoding.UTF8.GetBytes(string.Join('\n', "ccs-bar-auth-v2", direction, method.ToUpperInvariant(), NormalizePath(path), nonce)))).ToLowerInvariant();
    public static bool Verify(string token, string direction, string method, string path, string nonce, string proof)
    {
        try { return proof.Length == 64 && CryptographicOperations.FixedTimeEquals(Convert.FromHexString(Proof(token, direction, method, path, nonce)), Convert.FromHexString(proof)); }
        catch (FormatException) { return false; }
    }
    public static void Authenticate(HttpRequestMessage request, string token)
    {
        var nonce = Guid.NewGuid().ToString("N");
        request.Headers.Add(NonceHeader, nonce);
        request.Headers.Add(TokenHeader, Proof(token, "request", request.Method.Method, request.RequestUri!.PathAndQuery, nonce));
    }
    public static bool VerifyResponse(HttpRequestMessage request, HttpResponseMessage response, string token)
    {
        if (!request.Headers.TryGetValues(NonceHeader, out var nonces) || !response.Headers.TryGetValues(TokenHeader, out var proofs)) return false;
        var nonce = nonces.Take(2).ToArray(); var proof = proofs.Take(2).ToArray();
        return nonce.Length == 1 && proof.Length == 1 && Verify(token, "response", request.Method.Method, request.RequestUri!.PathAndQuery, nonce[0], proof[0]);
    }
}

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
        if (AuthMode != "loopback" || Port is < 1 or > 65535 || !Uri.TryCreate(BaseUrl, UriKind.Absolute, out var parsed) || parsed.Scheme != Uri.UriSchemeHttp || parsed.Port != Port || !IPAddress.TryParse(parsed.Host, out var address) || !address.Equals(IPAddress.Loopback) || parsed.AbsolutePath != "/" || !string.IsNullOrEmpty(parsed.Query) || !string.IsNullOrEmpty(parsed.Fragment)) return false;
        uri = parsed;
        return true;
    }
}

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
        if (Schema != 1 || Args is null || Args.Count is not (3 or 5) || Args[1] != "bar" || Args[2] != "serve" || Args.Count == 5 && (Args[3] != "--port" || !int.TryParse(Args[4], out var port) || port is < 1 or > 65535)) return false;
        if (!Path.IsPathFullyQualified(Runtime) || !Path.IsPathFullyQualified(Args[0]) || !Path.IsPathFullyQualified(Home) || !Path.GetFullPath(Home).Equals(Path.GetFullPath(expectedHome), StringComparison.OrdinalIgnoreCase) || CcsHome is not null && (!Path.IsPathFullyQualified(CcsHome) || CcsHome.Length == 0)) return false;
        var expectedShim = Path.Combine(expectedHome, "AppData", "Local", "CCS Bar", "launcher", "ccs.js");
        if (Path.GetFileName(Runtime).ToLowerInvariant() is not ("node.exe" or "bun.exe") || !Path.GetFullPath(Args[0]).Equals(Path.GetFullPath(expectedShim), StringComparison.OrdinalIgnoreCase)) return false;
        return trust.IsTrustedFile(Runtime) && trust.IsTrustedFile(Args[0]) && trust.IsTrustedDirectory(Home) && (CcsHome is null || trust.IsTrustedDirectory(CcsHome));
    }
}

public sealed class BarServerProbe
{
    public static readonly int[] FallbackPorts = [8080, 8181, 3000, 3001, 3002, 8000];
    readonly HttpClient http; readonly string? authToken; readonly TimeSpan probeTimeout;
    public BarServerProbe(HttpClient http, string? authToken = null, TimeSpan? probeTimeout = null, string? home = null, IReadOnlyDictionary<string, string?>? environment = null)
    { this.http = http; this.authToken = authToken ?? LoadAuthToken(home ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), environment); this.probeTimeout = probeTimeout ?? TimeSpan.FromSeconds(1.5); }
    public static string CcsHome(string home, IReadOnlyDictionary<string, string?>? environment = null)
    {
        var value = environment is null ? Environment.GetEnvironmentVariable("CCS_HOME") : environment.TryGetValue("CCS_HOME", out var configured) ? configured : null;
        return !string.IsNullOrWhiteSpace(value) ? value : Path.Combine(home, ".ccs");
    }
    public static string AuthTokenPath(string home, IReadOnlyDictionary<string, string?>? environment = null) => Path.Combine(CcsHome(home, environment), "bar", ".auth-token");
    public static string? LoadAuthToken(string home, IReadOnlyDictionary<string, string?>? environment = null)
    {
        try { var token = File.ReadAllText(AuthTokenPath(home, environment)).Trim(); return token.Length == 64 && token.All(Uri.IsHexDigit) ? token : null; }
        catch (IOException) { return null; } catch (UnauthorizedAccessException) { return null; }
    }
    public async Task<Uri?> FindLiveServerAsync(BarDiscovery? discovery, CancellationToken cancellationToken = default)
    {
        if (discovery?.ResolvedUri is { } discovered && await IsLiveAsync(discovered, cancellationToken)) return discovered;
        var candidates = FallbackPorts.Where(port => port != discovery?.Port).Select(port => new Uri($"http://127.0.0.1:{port}")).ToArray();
        using var found = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken); using var gate = new SemaphoreSlim(4);
        var tasks = candidates.Select(async uri => { await gate.WaitAsync(found.Token); try { return await IsLiveAsync(uri, found.Token) ? uri : null; } catch (OperationCanceledException) when (found.IsCancellationRequested && !cancellationToken.IsCancellationRequested) { return null; } finally { gate.Release(); } }).ToArray();
        while (tasks.Length > 0) { var complete = await Task.WhenAny(tasks); tasks = tasks.Where(task => task != complete).ToArray(); if (await complete is { } live) { found.Cancel(); return live; } }
        return null;
    }
    async Task<bool> IsLiveAsync(Uri baseUri, CancellationToken cancellationToken)
    {
        if (authToken is null) return false;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(probeTimeout);
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(baseUri, "api/bar/health"));
        request.Options.Set(new HttpRequestOptionsKey<TimeSpan>("CCSBar.Timeout"), probeTimeout);
        BarAuth.Authenticate(request, authToken);
        try
        {
            using var response = await http.SendAsync(request, timeout.Token);
            return response.StatusCode == HttpStatusCode.OK && BarAuth.VerifyResponse(request, response, authToken);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return false; }
        catch (HttpRequestException) { return false; }
    }
}
