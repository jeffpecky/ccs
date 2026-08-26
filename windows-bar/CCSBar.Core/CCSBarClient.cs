using System.Net.Http.Json;
using System.Text.Json;

namespace CCSBar.Core;

public sealed class CCSBarClient : IBarDataClient
{
    readonly Uri baseUri; readonly HttpClient http; readonly string authToken; readonly TimeSpan requestTimeout;
    public CCSBarClient(Uri baseUri, HttpClient http, string? authToken = null, string? home = null, IReadOnlyDictionary<string, string?>? environment = null, TimeSpan? requestTimeout = null)
    { this.baseUri = baseUri; this.http = http; this.authToken = authToken ?? BarServerProbe.LoadAuthToken(home ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), environment) ?? throw new InvalidOperationException("CCS Bar auth token unavailable"); this.requestTimeout = requestTimeout ?? TimeSpan.FromSeconds(8); }
    public async Task<IReadOnlyList<BarSummaryRow>> SummaryAsync(bool refresh = false, CancellationToken cancellationToken = default) =>
        await GetAsync<IReadOnlyList<BarSummaryRow>?>(refresh ? "api/bar/summary?refresh=true" : "api/bar/summary", cancellationToken) ?? throw new JsonException("CCS Bar summary response was null");

    public Task<BarAnalytics?> AnalyticsAsync(CancellationToken cancellationToken = default) => GetAsync<BarAnalytics?>("api/bar/analytics", cancellationToken);
    public Task PauseAsync(string provider, string accountId, CancellationToken ct = default) => PostAsync("api/accounts/bulk-pause", new { provider, accountIds = new[] { accountId } }, ct);
    public Task ResumeAsync(string provider, string accountId, CancellationToken ct = default) => PostAsync("api/accounts/bulk-resume", new { provider, accountIds = new[] { accountId } }, ct);
    public Task SetDefaultAsync(string name, CancellationToken ct = default) => PostAsync("api/accounts/default", new { name }, ct);
    public Task SoloAsync(string provider, string accountId, CancellationToken ct = default) => PostAsync("api/accounts/solo", new { provider, accountId }, ct);
    public Task TierLockAsync(string provider, string? tier, CancellationToken ct = default) => PostAsync("api/accounts/tier-lock", new { provider, tier }, ct);
    Task<IReadOnlyList<BarSummaryRow>> IBarDataClient.SummaryAsync(bool force, CancellationToken ct) => SummaryAsync(force, ct);
    Task IBarDataClient.PauseAsync(BarSummaryRow row, CancellationToken ct) => PauseAsync(row.Provider, row.AccountId, ct);
    Task IBarDataClient.ResumeAsync(BarSummaryRow row, CancellationToken ct) => ResumeAsync(row.Provider, row.AccountId, ct);
    Task IBarDataClient.SoloAsync(BarSummaryRow row, CancellationToken ct) => SoloAsync(row.Provider, row.AccountId, ct);
    Task IBarDataClient.SetDefaultAsync(BarSummaryRow row, CancellationToken ct) => SetDefaultAsync(row.Id, ct);
    Task IBarDataClient.TierLockAsync(BarSummaryRow row, string? tier, CancellationToken ct) => TierLockAsync(row.Provider, tier, ct);

    private async Task<T> GetAsync<T>(string path, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(requestTimeout);
        using var request = Request(HttpMethod.Get, path);
        HttpResponseMessage response;
        try { response = await http.SendAsync(request, timeout.Token); }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { throw new TimeoutException("CCS Bar API request timed out"); }
        using (response)
        {
        VerifyResponse(request, response);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<T>(BarJson.Options, timeout.Token) ?? default!;
        }
    }

    private async Task PostAsync(string path, object body, CancellationToken cancellationToken)
    {
        using var request = Request(HttpMethod.Post, path);
        request.Content = JsonContent.Create(body, options: BarJson.Options);
        using var response = await http.SendAsync(request, cancellationToken);
        VerifyResponse(request, response);
        response.EnsureSuccessStatusCode();
    }

    private HttpRequestMessage Request(HttpMethod method, string path)
    {
        var request = new HttpRequestMessage(method, new Uri(baseUri, path));
        BarAuth.Authenticate(request, authToken);
        return request;
    }
    void VerifyResponse(HttpRequestMessage request, HttpResponseMessage response)
    {
        if (!BarAuth.VerifyResponse(request, response, authToken)) throw new HttpRequestException("Invalid CCS Bar response proof");
    }
}
