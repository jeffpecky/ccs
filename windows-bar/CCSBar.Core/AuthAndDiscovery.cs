using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace CCSBar.Core;

public static class BarAuth
{
    public const string NonceHeader = "x-ccs-bar-nonce";
    public const string TokenHeader = "x-ccs-bar-token";

    public static string Proof(string token, string nonce) =>
        Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(token), Encoding.UTF8.GetBytes(nonce))).ToLowerInvariant();

    public static bool Verify(string token, string nonce, string proof)
    {
        try { return proof.Length == 64 && CryptographicOperations.FixedTimeEquals(Convert.FromHexString(Proof(token, nonce)), Convert.FromHexString(proof)); }
        catch (FormatException) { return false; }
    }

    public static void Authenticate(HttpRequestMessage request, string? token)
    {
        if (token is null) return;
        var nonce = Guid.NewGuid().ToString("N");
        request.Headers.Add(NonceHeader, nonce);
        request.Headers.Add(TokenHeader, Proof(token, nonce));
    }
}

public sealed record BarDiscovery(string BaseUrl, int Port, string AuthMode)
{
    public Uri ResolvedUri => Uri.TryCreate(BaseUrl, UriKind.Absolute, out var uri) ? uri : new Uri($"http://127.0.0.1:{Port}");
    public static string DefaultPath(string home) => Path.Combine(home, ".ccs", "bar.json");
    public static BarDiscovery Load(string home) => JsonSerializer.Deserialize<BarDiscovery>(File.ReadAllText(DefaultPath(home)), BarJson.Options) ?? throw new JsonException();
}

public sealed record BarLaunchDescriptor(int Schema, string Runtime, IReadOnlyList<string> Args, string Home, string? CcsHome)
{
    public bool HasSafeServerArguments =>
        Schema == 1 && Args.Count is 3 or 5 && Args[1] == "bar" && Args[2] == "serve" &&
        (Args.Count == 3 || Args[3] == "--port" && int.TryParse(Args[4], out var port) && port is >= 1 and <= 65535);

    public static string DefaultPath(string home) => Path.Combine(home, ".ccs", "bar", "launch.json");
    public static BarLaunchDescriptor Load(string home) => JsonSerializer.Deserialize<BarLaunchDescriptor>(File.ReadAllText(DefaultPath(home)), BarJson.Options) ?? throw new JsonException();
}

public sealed class BarServerProbe(HttpClient http, string? authToken)
{
    public static readonly int[] FallbackPorts = [3000, 3001, 3002, 8000, 8080];
    public static string AuthTokenPath(string home) => Path.Combine(home, ".ccs", "bar", ".auth-token");
    public static string? LoadAuthToken(string home)
    {
        try
        {
            var token = File.ReadAllText(AuthTokenPath(home)).Trim();
            return token.Length == 64 && token.All(Uri.IsHexDigit) ? token : null;
        }
        catch { return null; }
    }

    public async Task<Uri?> FindLiveServerAsync(BarDiscovery? discovery, CancellationToken cancellationToken = default)
    {
        var ports = (discovery is null ? [] : new[] { discovery.Port }).Concat(FallbackPorts).Distinct();
        foreach (var port in ports)
        {
            foreach (var host in new[] { "127.0.0.1", "[::1]" })
            {
                var baseUri = new Uri($"http://{host}:{port}");
                if (await IsLiveAsync(baseUri, cancellationToken)) return baseUri;
            }
        }
        return null;
    }

    private async Task<bool> IsLiveAsync(Uri baseUri, CancellationToken cancellationToken)
    {
        if (authToken is null) return false;
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(baseUri, "api/bar/summary"));
        BarAuth.Authenticate(request, authToken);
        try
        {
            using var response = await http.SendAsync(request, cancellationToken);
            if (response.StatusCode != System.Net.HttpStatusCode.OK || !response.Headers.TryGetValues(BarAuth.TokenHeader, out var values)) return false;
            var nonce = request.Headers.GetValues(BarAuth.NonceHeader).Single();
            return BarAuth.Verify(authToken, nonce, values.Single());
        }
        catch { return false; }
    }
}
