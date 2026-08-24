using System.Net.Http.Json;
using System.Text.Json;

namespace CCSBar.Core;

public sealed class CCSBarClient
{
    readonly Uri baseUri; readonly HttpClient http; readonly string authToken;
    public CCSBarClient(Uri baseUri, HttpClient http, string? authToken = null, string? home = null, IReadOnlyDictionary<string, string?>? environment = null)
    { this.baseUri = baseUri; this.http = http; this.authToken = authToken ?? BarServerProbe.LoadAuthToken(home ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), environment) ?? throw new InvalidOperationException("CCS Bar auth token unavailable"); }
    public Task<IReadOnlyList<BarSummaryRow>> SummaryAsync(bool refresh = false, CancellationToken cancellationToken = default) =>
        GetAsync<IReadOnlyList<BarSummaryRow>>(refresh ? "api/bar/summary?refresh=true" : "api/bar/summary", cancellationToken);

    public Task<BarAnalytics> AnalyticsAsync(CancellationToken cancellationToken = default) => GetAsync<BarAnalytics>("api/bar/analytics", cancellationToken);
    public Task PauseAsync(string provider, string accountId, CancellationToken ct = default) => PostAsync("api/accounts/bulk-pause", new { provider, accountIds = new[] { accountId } }, ct);
    public Task ResumeAsync(string provider, string accountId, CancellationToken ct = default) => PostAsync("api/accounts/bulk-resume", new { provider, accountIds = new[] { accountId } }, ct);
    public Task SetDefaultAsync(string name, CancellationToken ct = default) => PostAsync("api/accounts/default", new { name }, ct);
    public Task SoloAsync(string provider, string accountId, CancellationToken ct = default) => PostAsync("api/accounts/solo", new { provider, accountId }, ct);
    public Task TierLockAsync(string provider, string? tier, CancellationToken ct = default) => PostAsync("api/accounts/tier-lock", new { provider, tier }, ct);

    private async Task<T> GetAsync<T>(string path, CancellationToken cancellationToken)
    {
        using var request = Request(HttpMethod.Get, path);
        using var response = await http.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<T>(BarJson.Options, cancellationToken) ?? throw new JsonException();
    }

    private async Task PostAsync(string path, object body, CancellationToken cancellationToken)
    {
        using var request = Request(HttpMethod.Post, path);
        request.Content = JsonContent.Create(body, options: BarJson.Options);
        using var response = await http.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    private HttpRequestMessage Request(HttpMethod method, string path)
    {
        var request = new HttpRequestMessage(method, new Uri(baseUri, path));
        BarAuth.Authenticate(request, authToken);
        return request;
    }
}
