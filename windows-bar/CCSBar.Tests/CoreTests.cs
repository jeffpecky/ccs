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
    const string SummaryJson = "[{\"account_id\":\"acct\",\"provider\":\"codex\",\"displayName\":\"Codex Plus\",\"tier\":\"plus\",\"paused\":false,\"quota_percentage\":42.5,\"quotaStatus\":\"ok\",\"next_reset\":\"2026-08-27T00:00:00Z\",\"is_default\":true,\"last_activity_at\":\"2026-08-26T00:00:00Z\",\"today_cost\":1.25,\"health\":\"warning\",\"cached\":true,\"fetchedAt\":\"2026-08-26T00:01:00Z\",\"needsReauth\":false,\"surface\":\"codex\",\"profile\":\"default\",\"is_subscription\":true,\"quota_windows\":[{\"key\":\"5h\",\"label\":\"5h\",\"usedPercent\":57.5,\"remainingPercent\":42.5,\"resetAt\":\"2026-08-27T00:00:00Z\",\"windowMinutes\":300}],\"stale_as_of\":\"2026-08-25T23:00:00Z\"}]";
    const string AnalyticsJson = "{\"today\":{\"cost\":1,\"requests\":2},\"last7d\":{\"cost\":3,\"requests\":4},\"last30d\":{\"cost\":5,\"requests\":6},\"allTime\":{\"cost\":7,\"requests\":8},\"byDay\":[],\"topModels\":[],\"topModelsWindow\":\"30d\",\"lastActivityAt\":null,\"daysSinceLastActivity\":null,\"hasRecentData\":true,\"generatedAt\":\"now\"}";

    [TestMethod]
    public void Probe_PrefersDashboardPortsBeforeLegacyBarPorts()
    {
        CollectionAssert.AreEqual(new[] { 8080, 8181, 3000, 3001, 3002, 8000 }, BarServerProbe.FallbackPorts);
    }

    [TestMethod]
    public async Task Probe_UsesLightweightAuthenticatedHealthEndpoint()
    {
        var handler = new RecordingHandler(request => AuthenticatedResponse(request, "{\"ok\":true}"));
        var probe = new BarServerProbe(new HttpClient(handler), Token, TimeSpan.FromMilliseconds(100));

        Assert.IsNotNull(await probe.FindLiveServerAsync(new("http://127.0.0.1:4321", 4321, "loopback")));
        Assert.AreEqual("/api/bar/health", handler.Requests[0].RequestUri!.AbsolutePath);
        Assert.AreEqual("127.0.0.1", handler.Requests[0].RequestUri!.Host);
    }

    [TestMethod]
    public void Auth_ProofsAreDirectionMethodAndPathBound()
    {
        var proof = BarAuth.Proof(Token, "request", "GET", "/api/bar/summary?b=2&a=1", "ab".PadRight(32, '0'));
        Assert.IsTrue(BarAuth.Verify(Token, "request", "GET", "/api/bar/summary?a=1&b=2", "ab".PadRight(32, '0'), proof));
        Assert.IsFalse(BarAuth.Verify(Token, "response", "GET", "/api/bar/summary?a=1&b=2", "ab".PadRight(32, '0'), proof));
        Assert.IsFalse(BarAuth.Verify(Token, "request", "POST", "/api/bar/summary?a=1&b=2", "ab".PadRight(32, '0'), proof));
        Assert.IsFalse(BarAuth.Verify(Token, "request", "GET", "/api/bar/analytics?a=1&b=2", "ab".PadRight(32, '0'), proof));
    }

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
    public async Task Client_DecodesLiveMixedCaseSummaryContract()
    {
        var client = new CCSBarClient(new Uri("http://127.0.0.1:3000"), new HttpClient(new RecordingHandler(request => AuthenticatedResponse(request, SummaryJson))), Token);

        var row = (await client.SummaryAsync()).Single();

        Assert.AreEqual("Codex Plus", row.DisplayName);
        Assert.AreEqual("ok", row.QuotaStatus);
        Assert.AreEqual("2026-08-26T00:01:00Z", row.FetchedAt);
        Assert.IsFalse(row.NeedsReauth);
        Assert.IsTrue(row.IsSubscription);
        Assert.AreEqual(42.5, row.QuotaPercentage);
        Assert.AreEqual(57.5, row.QuotaWindows!.Single().UsedPercent);
        Assert.AreEqual("2026-08-25T23:00:00Z", row.StaleAsOf);
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
    public async Task Client_MalformedOrNullSummaryJsonThrowsInsteadOfReturningEmptyRows()
    {
        foreach (var json in new[] { "bad", "null", "[{\"account_id\":\"a\"}]" })
        {
            var client = new CCSBarClient(new Uri("http://127.0.0.1:3000"), new HttpClient(new RecordingHandler(request => AuthenticatedResponse(request, json))), Token);
            await Assert.ThrowsExceptionAsync<JsonException>(() => client.SummaryAsync());
        }
    }

    [TestMethod]
    public async Task Client_MalformedAnalyticsJsonThrowsButNullRemainsOptional()
    {
        foreach (var json in new[] { "bad", "{\"today\":null}" })
        {
            var client = new CCSBarClient(new Uri("http://127.0.0.1:3000"), new HttpClient(new RecordingHandler(request => AuthenticatedResponse(request, json))), Token);
            await Assert.ThrowsExceptionAsync<JsonException>(() => client.AnalyticsAsync());
        }
        var optional = new CCSBarClient(new Uri("http://127.0.0.1:3000"), new HttpClient(new RecordingHandler(request => AuthenticatedResponse(request, "null"))), Token);
        Assert.IsNull(await optional.AnalyticsAsync());
    }

    [TestMethod]
    public async Task Client_BoundsApiRequestsButPreservesCallerCancellation()
    {
        var handler = new RecordingHandler(async (_, ct) => { await Task.Delay(Timeout.InfiniteTimeSpan, ct); return new HttpResponseMessage(HttpStatusCode.OK); });
        var client = new CCSBarClient(new Uri("http://127.0.0.1:3000"), new HttpClient(handler), Token, requestTimeout: TimeSpan.FromMilliseconds(20));
        await Assert.ThrowsExceptionAsync<TimeoutException>(() => client.SummaryAsync());

        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        await Assert.ThrowsExceptionAsync<TaskCanceledException>(() => client.SummaryAsync(cancellationToken: cancelled.Token));
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
        Assert.AreEqual(BarDiscoveryState.Unsafe, BarDiscovery.Load(temp.Path).State);
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
        Assert.IsFalse(trust.Paths.Contains(launchPath, StringComparer.OrdinalIgnoreCase));
        File.WriteAllText(launchPath, "{\"schema\":1,\"runtime\":null,\"args\":null,\"home\":null}");
        Assert.IsNull(BarLaunchDescriptor.Load(home.Path, trust, environment));
    }

    [TestMethod]
    public void LaunchDescriptor_ReadabilityIsSeparateFromRuntimeTrust()
    {
        using var home = new TempDirectory();
        var launchPath = BarLaunchDescriptor.DefaultPath(home.Path);
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(launchPath)!);
        var shim = System.IO.Path.Combine(home.Path, "AppData", "Local", "CCS Bar", "launcher", "ccs.js");
        File.WriteAllText(launchPath, JsonSerializer.Serialize(new BarLaunchDescriptor(1, @"C:\Program Files\nodejs\node.exe", [shim, "bar", "serve"], home.Path, null), BarJson.Options));
        var trust = new DescriptorReadableTrustValidator(launchPath);

        Assert.IsNotNull(BarLaunchDescriptor.Load(home.Path, trust));
        Assert.IsFalse(trust.Paths.Contains(launchPath, StringComparer.OrdinalIgnoreCase));
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
    public async Task Probe_ClassifiesTimeoutAuthenticationAndUnreachableFailures()
    {
        var timeout = new BarServerProbe(new HttpClient(new RecordingHandler(async (_, ct) => { await Task.Delay(Timeout.InfiniteTimeSpan, ct); return new HttpResponseMessage(HttpStatusCode.OK); })), Token, TimeSpan.FromMilliseconds(20));
        Assert.AreEqual(BarConnectionState.Timeout, (await timeout.ProbeAsync(new("http://127.0.0.1:4321", 4321, "loopback"))).State);

        var auth = new BarServerProbe(new HttpClient(new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.OK))), Token, TimeSpan.FromMilliseconds(20));
        Assert.AreEqual(BarConnectionState.AuthenticationFailure, (await auth.ProbeAsync(new("http://127.0.0.1:4321", 4321, "loopback"))).State);

        var unreachable = new BarServerProbe(new HttpClient(new RecordingHandler((_, _) => Task.FromException<HttpResponseMessage>(new HttpRequestException("refused")))), Token, TimeSpan.FromMilliseconds(20));
        Assert.AreEqual(BarConnectionState.Unreachable, (await unreachable.ProbeAsync(new("http://127.0.0.1:4321", 4321, "loopback"))).State);

        var api = new BarServerProbe(new HttpClient(new RecordingHandler(request =>
        {
            var response = AuthenticatedResponse(request, "{}");
            response.StatusCode = HttpStatusCode.ServiceUnavailable;
            return response;
        })), Token, TimeSpan.FromMilliseconds(20));
        Assert.AreEqual(BarConnectionState.ApiFailure, (await api.ProbeAsync(new("http://127.0.0.1:4321", 4321, "loopback"))).State);
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

    [TestMethod]
    public void CardFormatting_ShortResetAndClockTimeMatchMacTiers()
    {
        var now = DateTimeOffset.Parse("2026-08-22T12:00:00+00:00");
        Assert.AreEqual("2h 18m", BarCardFormatting.ShortReset("2026-08-22T14:18:00+00:00", now));
        Assert.AreEqual("4h 2m", BarCardFormatting.ShortReset("2026-08-22T16:02:00+00:00", now));
        Assert.AreEqual("due", BarCardFormatting.ShortReset("2026-08-22T11:55:00+00:00", now));
        Assert.AreEqual("Mon", BarCardFormatting.ShortReset("2026-08-24T12:00:00+00:00", now));
        Assert.AreEqual("Sep 5", BarCardFormatting.ShortReset("2026-09-05T12:00:00+00:00", now));
        Assert.IsNull(BarCardFormatting.ShortReset("junk", now));
        Assert.IsNull(BarCardFormatting.ShortReset(null, now));
        Assert.AreEqual("11:25", BarCardFormatting.ClockTime("2026-08-22T11:25:00+00:00"));
        Assert.IsNull(BarCardFormatting.ClockTime("junk"));
        Assert.IsNull(BarCardFormatting.ClockTime(null));
    }

    [TestMethod]
    public void Quota_PaceWarningExtractsInlineChipFromPaceClause()
    {
        var now = DateTimeOffset.Parse("2026-08-22T12:00:00+00:00");
        Assert.AreEqual("⚠ ~22m", BarQuota.PaceWarning(92, 8, "2026-08-22T12:40:00+00:00", 300, now));
        Assert.IsNull(BarQuota.PaceWarning(28, 72, "2026-08-22T14:18:00+00:00", 300, now));
        Assert.IsNull(BarQuota.PaceWarning(100, 0, "2026-08-22T12:40:00+00:00", 300, now));
        Assert.IsNull(BarQuota.PaceWarning(92, 8, null, 300, now));
    }

    [TestMethod]
    public void Quota_OrderedWindowsFollowStableKeyRank()
    {
        var windows = new[] { Window("seven_day_sonnet", 10, 10080), Window("five_hour", 50, 300), Window("seven_day_opus", 20, 10080), Window("seven_day", 30, 10080) };
        CollectionAssert.AreEqual(new[] { "five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet" }, BarQuota.OrderedWindows(windows).Select(x => x.Key).ToArray());
    }

    [TestMethod]
    public void Subscriptions_OrderDefaultFirstThenTightestBindingSinksWindowless()
    {
        var lead = Row("lead", windows: new[] { Window("five_hour", 72, 300), Window("seven_day", 48, 10080) }) with { IsDefault = true };
        var tight = Row("tight", windows: new[] { Window("five_hour", 8, 300) });
        var codex = Row("codex", windows: new[] { Window("five_hour", 88, 300) });
        var windowless = Row("broken");
        var ordered = BarRows.OrderSubscriptions(new[] { tight, windowless, codex, lead });
        CollectionAssert.AreEqual(new[] { "agy:lead", "agy:tight", "agy:codex", "agy:broken" }, ordered.Select(x => x.Id).ToArray());
    }

    static QuotaWindowDetail Window(string key, double remaining, int minutes) => new(key, key, 100 - remaining, remaining, null, minutes);
    static BarSummaryRow Row(string id, double? quota = null, IReadOnlyList<QuotaWindowDetail>? windows = null, string? display = null, string? reset = null, bool paused = false, bool reauth = false) => new(id, "agy", display, null, paused, quota, quota is null ? "unsupported" : "ok", reset, false, null, null, "ok", false, null, reauth, null, null, false, windows, null);
    static string ResponseProof(HttpRequestMessage request) => BarAuth.Proof(Token, "response", request.Method.Method, request.RequestUri!.PathAndQuery, request.Headers.GetValues(BarAuth.NonceHeader).Single());
    static HttpResponseMessage AuthenticatedResponse(HttpRequestMessage request, string content)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(content) };
        response.Headers.Add(BarAuth.TokenHeader, ResponseProof(request));
        return response;
    }
}

[TestClass]
public sealed class ViewModelTests
{
    static readonly BarSummaryRow Row = new("acct", "agy", "Work", null, false, 42, "ok", null, true, null, 1, "ok", false, null, false, "claude", "default", false, null, null);
    static readonly BarAnalytics Analytics = new() { Today = new(1, 1), Last7d = new(2, 2), Last30d = new(3, 3), AllTime = new(4, 4), ByDay = [], TopModels = [], TopModelsWindow = "30d", HasRecentData = true, GeneratedAt = "now" };

    [TestMethod]
    public async Task ViewModel_LoadsSummaryAndAnalyticsIndependentlyAndPreservesStaleData()
    {
        var client = new FakeBarDataClient { Rows = [Row], Analytics = Analytics };
        var vm = new BarViewModel(new FakeConnector(client), new MemoryBarSettings(), new FakeClock());
        await vm.ReconnectAndLoadAsync(false);
        client.SummaryError = new InvalidOperationException("summary down");
        client.Analytics = Analytics with { Today = new(9, 9) };

        await vm.LoadAsync(false);

        Assert.AreEqual(Row, vm.Rows.Single());
        Assert.AreEqual(9, vm.Analytics!.Today.Cost);
        Assert.IsTrue(vm.SummaryStale);
        Assert.IsFalse(vm.AnalyticsStale);
        Assert.IsFalse(vm.Offline);
    }

    [TestMethod]
    public async Task ViewModel_DistinguishesValidEmptyFromConnectionAndApiFailures()
    {
        var empty = new BarViewModel(new FakeConnector(new FakeBarDataClient()), new MemoryBarSettings(), new FakeClock());
        await empty.ReconnectAndLoadAsync(false);
        Assert.AreEqual(BarConnectionState.Empty, empty.ConnectionState);
        Assert.IsFalse(empty.Offline);

        var timeoutConnector = new FakeConnector(null) { Failure = BarConnectionState.Timeout };
        var timeout = new BarViewModel(timeoutConnector, new MemoryBarSettings(), new FakeClock());
        await timeout.ReconnectAndLoadAsync(false);
        Assert.AreEqual(BarConnectionState.Timeout, timeout.ConnectionState);
        Assert.IsTrue(timeout.Offline);

        var broken = new BarViewModel(new FakeConnector(new FakeBarDataClient { SummaryError = new JsonException("bad summary") }), new MemoryBarSettings(), new FakeClock());
        await broken.ReconnectAndLoadAsync(false);
        Assert.AreEqual(BarConnectionState.ApiFailure, broken.ConnectionState);
        Assert.IsTrue(broken.Offline);
    }

    [TestMethod]
    public async Task ViewModel_RecoversAfterInitialProbeTimeout()
    {
        var connector = new FakeConnector(null) { Failure = BarConnectionState.Timeout };
        var vm = new BarViewModel(connector, new MemoryBarSettings(), new FakeClock());
        await vm.ReconnectAndLoadAsync(false);
        connector.Client = new FakeBarDataClient { Rows = [Row], Analytics = Analytics };
        connector.Failure = BarConnectionState.Unreachable;

        await vm.RetryAsync();

        Assert.AreEqual(BarConnectionState.Ready, vm.ConnectionState);
        Assert.IsFalse(vm.Offline);
        Assert.AreEqual(1, vm.Rows.Count);
    }

    [TestMethod]
    public async Task ViewModel_ClearsStartingWhenReconnectIsCancelled()
    {
        var connector = new BlockingConnector();
        var vm = new BarViewModel(connector, new MemoryBarSettings(), new FakeClock());
        using var cts = new CancellationTokenSource();
        var reconnect = vm.ReconnectAndLoadAsync(false, cts.Token);
        await connector.Started.Task;
        cts.Cancel();
        await Assert.ThrowsExceptionAsync<TaskCanceledException>(() => reconnect);
        Assert.IsFalse(vm.IsStarting);
    }

    [TestMethod]
    public async Task ViewModel_ApiTimeoutClearsRefreshAndMarksCachedRowsStale()
    {
        var client = new FakeBarDataClient { Rows = [Row], Analytics = Analytics };
        var connector = new FakeConnector(client);
        var vm = new BarViewModel(connector, new MemoryBarSettings(), new FakeClock());
        await vm.ReconnectAndLoadAsync(false);
        client.SummaryError = new TimeoutException("summary timed out");

        await vm.LoadAsync(true);

        Assert.IsFalse(vm.IsRefreshing);
        Assert.IsFalse(vm.Offline);
        Assert.IsTrue(vm.SummaryStale);
        Assert.AreEqual(BarConnectionState.Timeout, vm.ConnectionState);
    }

    [TestMethod]
    public async Task ViewModel_ReconnectTimeoutMarksCachedRowsStale()
    {
        var connector = new FakeConnector(new FakeBarDataClient { Rows = [Row], Analytics = Analytics });
        var vm = new BarViewModel(connector, new MemoryBarSettings(), new FakeClock());
        await vm.ReconnectAndLoadAsync(false);
        connector.Client = null;
        connector.Failure = BarConnectionState.Timeout;

        await vm.RetryAsync();

        Assert.IsFalse(vm.Offline);
        Assert.IsTrue(vm.SummaryStale);
        Assert.AreEqual(BarConnectionState.Timeout, vm.ConnectionState);
    }

    [TestMethod]
    public async Task ViewModel_SerializesRefreshAndLatestRequestWins()
    {
        var client = new ControlledBarDataClient(); var connector = new FakeConnector(client); var vm = new BarViewModel(connector, new MemoryBarSettings(), new FakeClock());
        var first = vm.ReconnectAndLoadAsync(false); await client.Started.Task;
        var second = vm.ForceRefreshAsync(); client.Release.TrySetResult();
        await Task.WhenAll(first, second);
        Assert.AreEqual(1, client.MaxConcurrent);
        Assert.AreEqual(1, client.ForcedLoads);
    }

    [TestMethod]
    public async Task ViewModel_RetryDoesNotLaunchButStartDoes()
    {
        var connector = new FakeConnector(null); var vm = new BarViewModel(connector, new MemoryBarSettings(), new FakeClock());
        await vm.RetryAsync(); await vm.StartAsync();
        CollectionAssert.AreEqual(new[] { false, true }, connector.Launches.ToArray());
    }

    [TestMethod]
    public async Task ViewModel_DeliversOnlyNewAlertsAndStopsDeterministically()
    {
        var settings = new MemoryBarSettings { Alerts = new(QuotaLevelsValue: [50]) }; var notifier = new RecordingNotifier();
        var client = new FakeBarDataClient { Rows = [Row with { QuotaPercentage = 40, NextReset = "2026-08-25T00:00:00Z" }], Analytics = Analytics };
        var vm = new BarViewModel(new FakeConnector(client), settings, new FakeClock(), notifier: notifier);
        await vm.ReconnectAndLoadAsync(false); await vm.LoadAsync(false); await vm.DisposeAsync();
        Assert.AreEqual(1, notifier.Delivered.Count);
    }

    [TestMethod]
    public async Task ViewModel_DebouncesOpenRefreshButForceRefreshNeverDebounces()
    {
        var clock = new FakeClock(); var client = new FakeBarDataClient { Rows = [Row], Analytics = Analytics };
        var vm = new BarViewModel(new FakeConnector(client), new MemoryBarSettings(), clock);
        await vm.OnPanelOpenedAsync(); await vm.OnPanelOpenedAsync();
        Assert.AreEqual(1, client.ForcedLoads);
        await vm.ForceRefreshAsync();
        Assert.AreEqual(2, client.ForcedLoads);
        clock.Now += TimeSpan.FromSeconds(15);
        await vm.OnPanelOpenedAsync();
        Assert.AreEqual(3, client.ForcedLoads);
    }

    [TestMethod]
    public async Task ViewModel_ExposesStartingOfflineRetryAlertsAndUpdateState()
    {
        var connector = new FakeConnector(null); var settings = new MemoryBarSettings();
        var vm = new BarViewModel(connector, settings, new FakeClock(), updateChecker: _ => Task.FromResult<string?>("9.0.0"), currentVersion: "1.0.0");
        await vm.ReconnectAndLoadAsync(false);
        Assert.IsTrue(vm.Offline);
        connector.Client = new FakeBarDataClient { Rows = [Row with { NeedsReauth = true }], Analytics = Analytics };
        await vm.RetryAsync(); await vm.CheckForUpdatesAsync();
        Assert.IsFalse(vm.Offline);
        Assert.AreEqual(1, vm.ActiveAlerts.Count);
        Assert.IsTrue(vm.UpdateAvailable);
        Assert.AreEqual("9.0.0", vm.LatestVersion);
    }

    [TestMethod]
    public void Carousel_DefaultProfileComesFirstAndKeyboardWraps()
    {
        var rows = new[] { Row with { AccountId = "b", Profile = "work", IsDefault = false }, Row with { AccountId = "a", Profile = "default", IsDefault = true } };
        var carousel = new ProfileCarousel(rows);
        Assert.AreEqual("a", carousel.Selected.AccountId);
        carousel.Move(-1);
        Assert.AreEqual("b", carousel.Selected.AccountId);
        carousel.Move(1);
        Assert.AreEqual("a", carousel.Selected.AccountId);
    }

    [TestMethod]
    public void Carousel_PagesOrderDefaultFirstThenTightestBindingWindowlessLast()
    {
        QuotaWindowDetail Win(double remaining) => new("five_hour", "5h", 100 - remaining, remaining, null, 300);
        var lead = Row with { AccountId = "lead", QuotaWindows = new[] { Win(80) } };
        var mid = Row with { AccountId = "mid", IsDefault = false, QuotaWindows = new[] { Win(50) } };
        var tight = Row with { AccountId = "tight", IsDefault = false, QuotaWindows = new[] { Win(8) } };
        var broken = Row with { AccountId = "broken", IsDefault = false, QuotaWindows = null };
        var carousel = new ProfileCarousel(new[] { tight, broken, mid, lead });
        CollectionAssert.AreEqual(new[] { "lead", "tight", "mid", "broken" }, carousel.Pages.Select(x => x.AccountId).ToArray());
        Assert.AreEqual(0, carousel.Index);
    }

    [TestMethod]
    public void PanelPlacement_AnchorsInsideWorkAreaForEveryTaskbarEdge()
    {
        var work = new BarRect(0, 40, 1920, 1040); var tray = new BarRect(1800, 1040, 32, 32);
        var panel = PanelPlacement.Anchor(work, tray, 360, 700);
        Assert.AreEqual(1472, panel.X);
        Assert.AreEqual(332, panel.Y);
        Assert.IsTrue(panel.Right <= work.Right && panel.Bottom <= work.Bottom);

        panel = PanelPlacement.Anchor(new(60, 0, 1920, 1080), new(0, 900, 40, 40), 360, 700);
        Assert.AreEqual(60, panel.X);
        Assert.IsTrue(panel.Bottom <= 1080);
    }

    [TestMethod]
    public void ThemePalette_MatchesSwiftAuthority()
    {
        Assert.AreEqual("#E2732A", BarThemePalette.Dark.Accent);
        Assert.AreEqual("#5B63D9", BarThemePalette.Dark.Subscription);
        Assert.AreEqual("#F5F5F7", BarThemePalette.Light.WindowSurface);
    }

    [TestMethod]
    public void Formatting_ProvidesSubscriptionTagsAndLastActiveFallback()
    {
        var baseRow = Row with { Provider = "claude-code", Surface = "ccsx", Profile = "default", IsSubscription = true };
        Assert.AreEqual("default", BarRows.AccountTag(baseRow));
        Assert.AreEqual("ccsx", BarRows.AccountTag(baseRow with { Profile = "work" }));
        Assert.AreEqual("Last active yesterday", BarFormatting.LastActiveLabel("2026-08-23T00:00:00Z", null, DateTimeOffset.Parse("2026-08-24T12:00:00Z")));
    }
}

sealed class FakeClock : IBarClock { public DateTimeOffset Now { get; set; } = DateTimeOffset.Parse("2026-08-24T00:00:00Z"); }
sealed class FakeConnector(IBarDataClient? client) : IBarConnector, IBarConnectionStatus { public IBarDataClient? Client { get; set; } = client; public BarConnectionState Failure { get; set; } = BarConnectionState.Unreachable; public BarConnectionState ConnectionState => Client is null ? Failure : BarConnectionState.Ready; public List<bool> Launches { get; } = []; public Task<IBarDataClient?> ConnectAsync(bool launch, CancellationToken cancellationToken) { Launches.Add(launch); return Task.FromResult(Client); } }
sealed class BlockingConnector : IBarConnector { public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously); public async Task<IBarDataClient?> ConnectAsync(bool launch, CancellationToken cancellationToken) { Started.TrySetResult(); await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken); return null; } }
sealed class FakeBarDataClient : IBarDataClient
{
    public IReadOnlyList<BarSummaryRow> Rows { get; set; } = []; public BarAnalytics? Analytics { get; set; } public Exception? SummaryError { get; set; } public int ForcedLoads { get; private set; }
    public Task<IReadOnlyList<BarSummaryRow>> SummaryAsync(bool force, CancellationToken ct) { if (force) ForcedLoads++; return SummaryError is null ? Task.FromResult(Rows) : Task.FromException<IReadOnlyList<BarSummaryRow>>(SummaryError); }
    public Task<BarAnalytics?> AnalyticsAsync(CancellationToken ct) => Task.FromResult(Analytics);
    public Task PauseAsync(BarSummaryRow row, CancellationToken ct) => Task.CompletedTask; public Task ResumeAsync(BarSummaryRow row, CancellationToken ct) => Task.CompletedTask; public Task SoloAsync(BarSummaryRow row, CancellationToken ct) => Task.CompletedTask; public Task SetDefaultAsync(BarSummaryRow row, CancellationToken ct) => Task.CompletedTask; public Task TierLockAsync(BarSummaryRow row, string? tier, CancellationToken ct) => Task.CompletedTask;
}

sealed class ControlledBarDataClient : IBarDataClient
{
    int concurrent; public int MaxConcurrent { get; private set; } public int ForcedLoads { get; private set; } public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously); public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public async Task<IReadOnlyList<BarSummaryRow>> SummaryAsync(bool force, CancellationToken ct) { if (force) ForcedLoads++; var current = Interlocked.Increment(ref concurrent); MaxConcurrent = Math.Max(MaxConcurrent, current); Started.TrySetResult(); try { await Release.Task.WaitAsync(ct); return []; } finally { Interlocked.Decrement(ref concurrent); } }
    public Task<BarAnalytics?> AnalyticsAsync(CancellationToken ct) => Task.FromResult<BarAnalytics?>(null);
    public Task PauseAsync(BarSummaryRow row, CancellationToken ct) => Task.CompletedTask; public Task ResumeAsync(BarSummaryRow row, CancellationToken ct) => Task.CompletedTask; public Task SoloAsync(BarSummaryRow row, CancellationToken ct) => Task.CompletedTask; public Task SetDefaultAsync(BarSummaryRow row, CancellationToken ct) => Task.CompletedTask; public Task TierLockAsync(BarSummaryRow row, string? tier, CancellationToken ct) => Task.CompletedTask;
}

sealed class RecordingNotifier : IBarNotifier { public List<BarNotification> Delivered { get; } = []; public void Deliver(IReadOnlyList<BarNotification> notifications) => Delivered.AddRange(notifications); }

sealed class MemoryBarSettings : IBarSettings
{
    public BarUiSettings Ui { get; set; } = new(); public BarPreferences Alerts { get; set; } = new(); public IReadOnlySet<string> FiredKeys { get; set; } = new HashSet<string>();
    public void Save() { }
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

sealed class DescriptorReadableTrustValidator(string descriptorPath) : ILaunchTrustValidator
{
    public List<string> Paths { get; } = [];
    public bool IsTrustedFile(string path) { Paths.Add(path); return !path.Equals(descriptorPath, StringComparison.OrdinalIgnoreCase); }
    public bool IsTrustedDirectory(string path) { Paths.Add(path); return true; }
}

sealed class TempDirectory : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), Guid.NewGuid().ToString("N"));
    public TempDirectory() => Directory.CreateDirectory(Path);
    public void Dispose() => Directory.Delete(Path, true);
}
