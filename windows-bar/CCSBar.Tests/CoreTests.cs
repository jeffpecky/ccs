using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;
using CCSBar.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace CCSBar.Tests;

[TestClass]
public sealed class CoreTests
{
    const string Token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const string SummaryJson = "[{\"account_id\":\"acct\",\"provider\":\"codex\",\"paused\":false,\"quota_percentage\":42.5,\"quota_status\":\"ok\",\"is_default\":true,\"health\":\"warning\",\"cached\":true,\"needs_reauth\":false}]";
    const string AnalyticsJson = "{\"today\":{\"cost\":1,\"requests\":2},\"last7d\":{\"cost\":3,\"requests\":4},\"last30d\":{\"cost\":5,\"requests\":6},\"allTime\":{\"cost\":7,\"requests\":8},\"byDay\":[],\"topModels\":[],\"topModelsWindow\":\"30d\",\"lastActivityAt\":null,\"daysSinceLastActivity\":null,\"hasRecentData\":true,\"generatedAt\":\"now\"}";

    [TestMethod]
    public async Task Client_UsesBackendContractsAndAuthenticatesEveryRequest()
    {
        var handler = new RecordingHandler(request => AuthenticatedResponse(request, request.RequestUri!.AbsolutePath.EndsWith("analytics") ? AnalyticsJson : SummaryJson));
        var client = new CCSBarClient(new Uri("http://127.0.0.1:3000"), new HttpClient(handler), Token);
        await client.SummaryAsync(); await client.AnalyticsAsync(); await client.PauseAsync("agy", "a"); await client.ResumeAsync("agy", "a"); await client.SetDefaultAsync("agy:a"); await client.SoloAsync("agy", "a"); await client.TierLockAsync("agy", null);

        CollectionAssert.AreEqual(new[] { "/api/bar/summary", "/api/bar/analytics", "/api/accounts/bulk-pause", "/api/accounts/bulk-resume", "/api/accounts/default", "/api/accounts/solo", "/api/accounts/tier-lock" }, handler.Requests.Select(x => x.RequestUri!.AbsolutePath).ToArray());
        StringAssert.Contains(handler.Bodies[2]!, "\"accountIds\":[\"a\"]");
        StringAssert.Contains(handler.Bodies[3]!, "\"accountIds\":[\"a\"]");
        StringAssert.Contains(handler.Bodies[4]!, "\"name\":\"agy:a\"");
        Assert.IsTrue(handler.Requests.All(x => x.Headers.Contains(BarAuth.NonceHeader) && x.Headers.Contains(BarAuth.TokenHeader)));
    }

    [TestMethod]
    public async Task Client_RejectsMissingInvalidAndDuplicateResponseProofsOnEveryApiResponse()
    {
        foreach (var proof in new[] { "missing", "invalid", "duplicate" })
        {
            var handler = new RecordingHandler(request =>
            {
                var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(request.Method == HttpMethod.Get ? SummaryJson : "") };
                if (proof != "missing") response.Headers.TryAddWithoutValidation(BarAuth.TokenHeader, proof == "invalid" ? new[] { new string('0', 64) } : new[] { ResponseProof(request), ResponseProof(request) });
                return response;
            });
            var client = new CCSBarClient(new Uri("http://127.0.0.1:3000"), new HttpClient(handler), Token);
            await Assert.ThrowsExceptionAsync<HttpRequestException>(() => client.SummaryAsync());
            await Assert.ThrowsExceptionAsync<HttpRequestException>(() => client.PauseAsync("agy", "a"));
        }
    }

    [TestMethod]
    public async Task Client_MalformedOrNullModelJsonFailsClosedWithoutThrowing()
    {
        foreach (var json in new[] { "bad", "null", "[{\"account_id\":null}]" })
        {
            var client = new CCSBarClient(new Uri("http://127.0.0.1:3000"), new HttpClient(new RecordingHandler(request => AuthenticatedResponse(request, json))), Token);
            Assert.AreEqual(0, (await client.SummaryAsync()).Count);
        }
        foreach (var json in new[] { "bad", "null", "{\"today\":null}" })
        {
            var client = new CCSBarClient(new Uri("http://127.0.0.1:3000"), new HttpClient(new RecordingHandler(request => AuthenticatedResponse(request, json))), Token);
            Assert.IsNull(await client.AnalyticsAsync());
        }
    }

    [TestMethod]
    public void Discovery_LoadsSafeStatesAndRejectsNonLoopbackData()
    {
        using var temp = new TempDirectory();
        Assert.AreEqual(BarDiscoveryState.Missing, BarDiscovery.Load(temp.Path).State);
        Directory.CreateDirectory(System.IO.Path.Combine(temp.Path, ".ccs"));
        File.WriteAllText(BarDiscovery.DefaultPath(temp.Path), "bad");
        Assert.AreEqual(BarDiscoveryState.Malformed, BarDiscovery.Load(temp.Path).State);
        File.WriteAllText(BarDiscovery.DefaultPath(temp.Path), "{\"baseUrl\":\"http://evil.example:3000\",\"port\":3000,\"authMode\":\"loopback\"}");
        Assert.AreEqual(BarDiscoveryState.Unsafe, BarDiscovery.Load(temp.Path).State);
        File.WriteAllText(BarDiscovery.DefaultPath(temp.Path), "{\"baseUrl\":\"http://127.0.0.1:3000\",\"port\":0,\"authMode\":\"none\"}");
        Assert.AreEqual(BarDiscoveryState.Unsafe, BarDiscovery.Load(temp.Path).State);
        File.WriteAllText(BarDiscovery.DefaultPath(temp.Path), "{\"baseUrl\":\"http://[::1]:4321\",\"port\":4321,\"authMode\":\"loopback\"}");
        Assert.AreEqual(BarDiscoveryState.Ready, BarDiscovery.Load(temp.Path).State);
    }

    [TestMethod]
    public void DiscoveryAndLaunchDescriptor_HonorCcsHomeAndRejectNullJson()
    {
        using var home = new TempDirectory(); using var ccsHome = new TempDirectory();
        var environment = new Dictionary<string, string?> { ["CCS_HOME"] = ccsHome.Path };
        File.WriteAllText(System.IO.Path.Combine(ccsHome.Path, "bar.json"), "null");
        Assert.AreEqual(BarDiscoveryState.Malformed, BarDiscovery.Load(home.Path, environment).State);

        Directory.CreateDirectory(System.IO.Path.Combine(ccsHome.Path, "bar"));
        var launchPath = System.IO.Path.Combine(ccsHome.Path, "bar", "launch.json");
        File.WriteAllText(launchPath, "null");
        var trust = new RecordingTrustValidator(true);
        Assert.IsNull(BarLaunchDescriptor.Load(home.Path, trust, environment));
        Assert.AreEqual(launchPath, trust.Paths[0]);
        File.WriteAllText(launchPath, "{\"schema\":1,\"runtime\":null,\"args\":null,\"home\":null}");
        Assert.IsNull(BarLaunchDescriptor.Load(home.Path, trust, environment));
    }

    [TestMethod]
    public void TokenResolution_UsesCcsHomeAndValidatesToken()
    {
        using var home = new TempDirectory(); using var ccsHome = new TempDirectory();
        Directory.CreateDirectory(System.IO.Path.Combine(ccsHome.Path, "bar"));
        File.WriteAllText(System.IO.Path.Combine(ccsHome.Path, "bar", ".auth-token"), Token + "\n");
        Assert.AreEqual(Token, BarServerProbe.LoadAuthToken(home.Path, new Dictionary<string, string?> { ["CCS_HOME"] = ccsHome.Path }));
        File.WriteAllText(System.IO.Path.Combine(ccsHome.Path, "bar", ".auth-token"), "bad");
        Assert.IsNull(BarServerProbe.LoadAuthToken(home.Path, new Dictionary<string, string?> { ["CCS_HOME"] = ccsHome.Path }));
    }

    [TestMethod]
    public async Task Probe_HasPerAttemptTimeoutAndPropagatesCallerCancellation()
    {
        var handler = new RecordingHandler(async (_, ct) => { await Task.Delay(Timeout.InfiniteTimeSpan, ct); return new HttpResponseMessage(HttpStatusCode.OK); });
        var probe = new BarServerProbe(new HttpClient(handler), Token, TimeSpan.FromMilliseconds(40));
        var watch = Stopwatch.StartNew();
        Assert.IsNull(await probe.FindLiveServerAsync(null));
        Assert.IsTrue(watch.Elapsed < TimeSpan.FromSeconds(1));
        using var cts = new CancellationTokenSource(10);
        try { await probe.FindLiveServerAsync(null, cts.Token); Assert.Fail("Expected cancellation"); }
        catch (OperationCanceledException) { }
    }

    [TestMethod]
    public async Task Probe_DuplicateProofHeadersFailClosedWithoutThrowing()
    {
        var probe = new BarServerProbe(new HttpClient(new RecordingHandler(request =>
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK);
            response.Headers.TryAddWithoutValidation(BarAuth.TokenHeader, new[] { ResponseProof(request), ResponseProof(request) });
            return response;
        })), Token, TimeSpan.FromMilliseconds(20));
        Assert.IsNull(await probe.FindLiveServerAsync(new("http://127.0.0.1:4321", 4321, "loopback")));
    }

    [TestMethod]
    public void LaunchDescriptor_RequiresTrustedAbsoluteWindowsPaths()
    {
        var d = new BarLaunchDescriptor(1, @"C:\Program Files\nodejs\node.exe", new[] { @"C:\Users\me\AppData\Local\CCS Bar\launcher\ccs.js", "bar", "serve", "--port", "3000" }, @"C:\Users\me", @"C:\Users\me\.ccs");
        var trust = new RecordingTrustValidator(true);
        Assert.IsTrue(d.IsSafe(@"C:\Users\me", trust));
        CollectionAssert.AreEquivalent(new[] { d.Runtime, d.Args[0], d.Home, d.CcsHome! }, trust.Paths.ToArray());
        Assert.IsFalse(d with { Runtime = "cmd.exe" } is var relative && relative.IsSafe(d.Home, trust));
        Assert.IsFalse(d with { Args = new[] { d.Args[0], "bar", "serve", "& calc" } } is var injected && injected.IsSafe(d.Home, trust));
        Assert.IsFalse(d.IsSafe(d.Home, new RecordingTrustValidator(false)));
    }

    [TestMethod]
    public void Json_RequiresContractFieldsButKeepsExplicitCompatibilityDefaults()
    {
        Assert.ThrowsException<JsonException>(() => JsonSerializer.Deserialize<BarSummaryRow>("{\"account_id\":\"a\"}", BarJson.Options));
        Assert.ThrowsException<JsonException>(() => JsonSerializer.Deserialize<BarAnalytics>("{\"today\":{}}", BarJson.Options));
        var analytics = JsonSerializer.Deserialize<BarAnalytics>(AnalyticsJson, BarJson.Options)!;
        Assert.AreEqual(0d, analytics.MonthToDate.Cost); Assert.AreEqual(0, analytics.ByHour.Count); Assert.AreEqual(0, analytics.BySurface.Count);
    }

    [TestMethod]
    public void Preferences_CorruptValuesFallBackSafely()
    {
        var value = BarPreferencesCodec.Decode(new Dictionary<string, object?> { [BarPreferenceKeys.QuotaLevels] = "junk", [BarPreferenceKeys.DailyCapUsd] = "junk", [BarPreferenceKeys.GlanceMode] = "junk" });
        CollectionAssert.AreEqual(new[] { 20, 10, 0 }, value.QuotaLevels.ToArray());
        Assert.AreEqual(500d, value.DailyCapUsd); Assert.AreEqual(BarGlanceMode.Auto, value.GlanceMode);
    }

    [TestMethod]
    public void Semver_ImplementsPrereleasePrecedence()
    {
        Assert.IsTrue(BarUpdate.IsNewer("1.0.0", "1.0.0-rc.1"));
        Assert.IsTrue(BarUpdate.IsNewer("1.0.0-beta.11", "1.0.0-beta.2"));
        Assert.IsTrue(BarUpdate.IsNewer("1.0.0-rc.1", "1.0.0-beta.11"));
        Assert.IsFalse(BarUpdate.IsNewer("1.0.0-beta.2", "1.0.0"));
        Assert.IsFalse(BarUpdate.IsNewer("1.0.0-01", "1.0.0-1"));
    }

    [TestMethod]
    public void Formatting_DebouncePaceHeadroomAndActualQuotaOrderingMatchMac()
    {
        var rows = new[] { Row("a", quota: 30), Row("b", quota: 10) };
        Assert.AreEqual("agy 10%", BarFormatting.StatusTitle(rows, null));
        Assert.AreEqual("Last active today", BarFormatting.LastActiveLabel(DateTimeOffset.UtcNow.ToString("O"), 0, DateTimeOffset.UtcNow));
        Assert.AreEqual("limit reached", BarQuota.PaceClause(100, 0, null, null, DateTimeOffset.UtcNow));
        Assert.AreEqual("seven_day", BarQuota.SelectBindingWindow(new[] { Window("seven_day_sonnet", 20, 10080), Window("seven_day", 20, 10080) })!.Key);
        var leader = BarQuota.HeadroomLeader(new[] { Row("a", windows: new[] { Window("five_hour", 40, 300) }, display: "Alpha"), Row("b", windows: new[] { Window("five_hour", 70, 300) }, display: "Beta") });
        Assert.AreEqual("Beta", leader?.Label);
        var debounce = new RefreshDebouncer(TimeSpan.FromSeconds(15)); var now = DateTimeOffset.UtcNow;
        Assert.IsTrue(debounce.ShouldRefresh(now)); Assert.IsFalse(debounce.ShouldRefresh(now.AddSeconds(14))); Assert.IsTrue(debounce.ShouldRefresh(now.AddSeconds(15)));
    }

    [TestMethod]
    public void Alerts_EvaluateDedupeAndPruneAllKinds()
    {
        var now = new DateTimeOffset(2026, 8, 24, 12, 0, 0, TimeSpan.Zero);
        var rows = new[] { Row("a", quota: 9, reset: "2026-08-25T00:00:00Z", paused: true, reauth: true) };
        var analytics = JsonSerializer.Deserialize<BarAnalytics>(AnalyticsJson.Replace("\"cost\":1", "\"cost\":600", StringComparison.Ordinal), BarJson.Options)! with { MonthToDate = new(11000, 1) };
        var first = BarAlertEngine.Evaluate(rows, analytics, new(), new[] { "stale|x|y" }, now);
        CollectionAssert.AreEquivalent(Enum.GetValues<BarAlertKind>(), first.ToDeliver.Select(x => x.Kind).ToArray());
        Assert.AreEqual(5, first.FiredKeys.Count);
        Assert.AreEqual(0, BarAlertEngine.Evaluate(rows, analytics, new(), first.FiredKeys, now).ToDeliver.Count);
        Assert.AreEqual(0, BarAlertEngine.Evaluate([], null, new(), first.FiredKeys, now.AddMonths(1)).FiredKeys.Count);
    }

    [TestMethod]
    public void Alerts_RoundPositiveHalvesAwayFromZeroAndUseInjectedLocalCalendar()
    {
        var zone = TimeZoneInfo.CreateCustomTimeZone("UTC-8", TimeSpan.FromHours(-8), "UTC-8", "UTC-8");
        var beforeLocalMidnight = new DateTimeOffset(2026, 9, 1, 7, 30, 0, TimeSpan.Zero);
        var afterLocalMidnight = beforeLocalMidnight.AddHours(1);
        var analytics = JsonSerializer.Deserialize<BarAnalytics>(AnalyticsJson.Replace("\"cost\":1", "\"cost\":600", StringComparison.Ordinal), BarJson.Options)! with { MonthToDate = new(11000, 1) };
        var first = BarAlertEngine.Evaluate(new[] { Row("a", quota: 10.5) }, analytics, new(), [], beforeLocalMidnight, zone);
        StringAssert.Contains(first.ToDeliver.Single(x => x.Kind == BarAlertKind.QuotaRemainingBelow).Body, "11% remaining");
        Assert.IsTrue(first.FiredKeys.Contains("dailySpendAbove|global|2026-08-31"));
        Assert.IsTrue(first.FiredKeys.Contains("monthSpendAbove|global|2026-08"));
        var second = BarAlertEngine.Evaluate([], analytics, new(), first.FiredKeys, afterLocalMidnight, zone);
        Assert.IsTrue(second.ToDeliver.Any(x => x.Kind == BarAlertKind.DailySpendAbove));
        Assert.IsTrue(second.ToDeliver.Any(x => x.Kind == BarAlertKind.MonthSpendAbove));
    }

    [TestMethod]
    public async Task UpdateFetch_UsesStableContractTimeoutNoCacheAndSafeNulls()
    {
        var handler = new RecordingHandler(_ => new(HttpStatusCode.OK) { Content = new StringContent(" 1.2.3-rc.1\n") });
        Assert.AreEqual("1.2.3-rc.1", await BarUpdate.FetchLatestPublishedVersionAsync(new HttpClient(handler)));
        Assert.AreEqual("https://github.com/jeffpecky/ccs/releases/download/ccs-bar-latest/version.txt", handler.Requests.Single().RequestUri!.ToString());
        Assert.AreEqual("no-cache", handler.Requests.Single().Headers.CacheControl!.ToString());
        Assert.AreEqual(TimeSpan.FromSeconds(8), handler.Timeouts.Single());
    }

    static QuotaWindowDetail Window(string key, double remaining, int minutes) => new(key, key, 100 - remaining, remaining, null, minutes);
    static BarSummaryRow Row(string id, double? quota = null, IReadOnlyList<QuotaWindowDetail>? windows = null, string? display = null, string? reset = null, bool paused = false, bool reauth = false) => new(id, "agy", display, null, paused, quota, quota is null ? "unsupported" : "ok", reset, false, null, null, "ok", false, null, reauth, null, null, false, windows, null);
    static string ResponseProof(HttpRequestMessage request) => BarAuth.Proof(Token, request.Headers.GetValues(BarAuth.NonceHeader).Single());
    static HttpResponseMessage AuthenticatedResponse(HttpRequestMessage request, string content)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(content) };
        response.Headers.Add(BarAuth.TokenHeader, ResponseProof(request));
        return response;
    }
}

sealed class RecordingHandler : HttpMessageHandler
{
    readonly Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond;
    public List<HttpRequestMessage> Requests { get; } = []; public List<string?> Bodies { get; } = []; public List<TimeSpan> Timeouts { get; } = [];
    public RecordingHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : this((r, _) => Task.FromResult(respond(r))) { }
    public RecordingHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) => this.respond = respond;
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) { Requests.Add(request); Bodies.Add(request.Content is null ? null : await request.Content.ReadAsStringAsync(ct)); Timeouts.Add(request.Options.TryGetValue(new HttpRequestOptionsKey<TimeSpan>("CCSBar.Timeout"), out var timeout) ? timeout : Timeout.InfiniteTimeSpan); return await respond(request, ct); }
}

sealed class RecordingTrustValidator(bool trusted) : ILaunchTrustValidator
{
    public List<string> Paths { get; } = [];
    public bool IsTrustedFile(string path) { Paths.Add(path); return trusted; }
    public bool IsTrustedDirectory(string path) { Paths.Add(path); return trusted; }
}

sealed class TempDirectory : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), Guid.NewGuid().ToString("N"));
    public TempDirectory() => Directory.CreateDirectory(Path);
    public void Dispose() => Directory.Delete(Path, true);
}
