using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using CCSBar.Core;

const string AnalyticsPayload = "{\"today\":{\"cost\":0,\"requests\":0},\"last7d\":{\"cost\":0,\"requests\":0},\"last30d\":{\"cost\":0,\"requests\":0},\"monthToDate\":{\"cost\":0,\"requests\":0},\"allTime\":{\"cost\":0,\"requests\":0},\"byDay\":[],\"byHour\":[],\"topModels\":[],\"topModelsWindow\":\"30d\",\"lastActivityAt\":null,\"daysSinceLastActivity\":null,\"hasRecentData\":false,\"generatedAt\":\"now\",\"bySurface\":[]}";

var tests = new List<(string Name, Func<Task> Run)>
{
    ("summary JSON contract", SummaryJson),
    ("analytics compatibility defaults", AnalyticsJson),
    ("HMAC nonce auth", HmacAuth),
    ("discovery and launch descriptor", Discovery),
    ("authenticated server probing", Probe),
    ("typed API client", Client),
    ("formatting and row policy", Formatting),
    ("quota calculations", Quota),
    ("preferences codec", Preferences),
    ("update semver", Semver),
};

foreach (var test in tests)
{
    await test.Run();
    Console.WriteLine($"PASS {test.Name}");
}

return;

static Task SummaryJson()
{
    const string json = """
    [{"account_id":"acct","provider":"codex","display_name":"Work","tier":"pro","paused":false,"quota_percentage":42.5,"quota_status":"ok","next_reset":"2026-08-25T00:00:00Z","is_default":true,"last_activity_at":null,"today_cost":1.25,"health":"warning","cached":true,"fetched_at":"2026-08-24T00:00:00Z","needs_reauth":false,"surface":"ccsx","profile":"work","is_subscription":true,"quota_windows":[{"key":"5h","label":"5 hours","usedPercent":57.5,"remainingPercent":42.5,"resetAt":"2026-08-25T00:00:00Z","windowMinutes":300}],"stale_as_of":null}]
    """;
    var row = JsonSerializer.Deserialize<BarSummaryRow[]>(json, BarJson.Options)!.Single();
    Equal("acct", row.AccountId);
    Equal(42.5, row.QuotaPercentage);
    Equal("5h", row.QuotaWindows!.Single().Key);
    Equal("!", row.HealthDot);
    Equal("codex:acct", row.Id);
    return Task.CompletedTask;
}

static Task AnalyticsJson()
{
    const string json = """
    {"today":{"cost":1,"requests":2},"last7d":{"cost":3,"requests":4},"last30d":{"cost":5,"requests":6},"allTime":{"cost":7,"requests":8},"byDay":[],"topModels":[],"topModelsWindow":"30d","lastActivityAt":null,"daysSinceLastActivity":null,"hasRecentData":true,"generatedAt":"now"}
    """;
    var value = JsonSerializer.Deserialize<BarAnalytics>(json, BarJson.Options)!;
    Equal(0d, value.MonthToDate.Cost);
    Equal(0, value.ByHour.Count);
    Equal(0, value.BySurface.Count);
    return Task.CompletedTask;
}

static Task HmacAuth()
{
    Equal("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8", BarAuth.Proof("key", "The quick brown fox jumps over the lazy dog"));
    True(BarAuth.Verify("key", "nonce", BarAuth.Proof("key", "nonce")));
    False(BarAuth.Verify("key", "nonce", "not-hex"));
    return Task.CompletedTask;
}

static Task Discovery()
{
    var home = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(Path.Combine(home, ".ccs", "bar"));
    File.WriteAllText(BarDiscovery.DefaultPath(home), "{\"baseUrl\":\"\",\"port\":4312,\"authMode\":\"loopback\"}");
    File.WriteAllText(BarLaunchDescriptor.DefaultPath(home), "{\"schema\":1,\"runtime\":\"C:\\\\bun.exe\",\"args\":[\"ccs\",\"bar\",\"serve\",\"--port\",\"4312\"],\"home\":\"C:\\\\Users\\\\me\",\"ccsHome\":null}");
    File.WriteAllText(Path.Combine(home, ".ccs", "bar", ".auth-token"), new string('a', 64));
    Equal("http://127.0.0.1:4312/", BarDiscovery.Load(home).ResolvedUri.ToString());
    True(BarLaunchDescriptor.Load(home).HasSafeServerArguments);
    Equal(new string('a', 64), BarServerProbe.LoadAuthToken(home));
    False(new BarLaunchDescriptor(1, "bun", ["ccs", "bar", "serve", "--port", "0"], home, null).HasSafeServerArguments);
    Directory.Delete(home, true);
    return Task.CompletedTask;
}

static async Task Probe()
{
    var handler = new RecordingHandler(request =>
    {
        var nonce = request.Headers.GetValues(BarAuth.NonceHeader).Single();
        var response = new HttpResponseMessage(request.RequestUri!.Port == 3001 ? HttpStatusCode.OK : HttpStatusCode.NotFound);
        if (response.IsSuccessStatusCode) response.Headers.Add(BarAuth.TokenHeader, BarAuth.Proof("secret", nonce));
        return response;
    });
    var found = await new BarServerProbe(new HttpClient(handler), "secret").FindLiveServerAsync(new BarDiscovery("http://localhost:9999", 9999, "loopback"));
    Equal("http://127.0.0.1:3001/", found!.ToString());
    Equal([9999, 9999, 3000, 3000, 3001], handler.Requests.Select(x => x.RequestUri!.Port).ToArray());
}

static async Task Client()
{
    var handler = new RecordingHandler(request => request.Method == HttpMethod.Get
        ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(request.RequestUri!.AbsolutePath.EndsWith("analytics") ? AnalyticsPayload : "[]", Encoding.UTF8, "application/json") }
        : new HttpResponseMessage(HttpStatusCode.NoContent));
    var client = new CCSBarClient(new Uri("http://127.0.0.1:3000"), new HttpClient(handler), "secret");
    await client.SummaryAsync(true);
    await client.AnalyticsAsync();
    await client.PauseAsync("codex", "a");
    await client.ResumeAsync("codex", "a");
    await client.SetDefaultAsync("work");
    await client.SoloAsync("codex", "a");
    await client.TierLockAsync("codex", null);
    Equal("?refresh=true", handler.Requests[0].RequestUri!.Query);
    True(handler.Requests.All(x => x.Headers.Contains(BarAuth.NonceHeader) && x.Headers.Contains(BarAuth.TokenHeader)));
    Equal(["/api/accounts/pause", "/api/accounts/resume", "/api/profiles/default", "/api/accounts/solo", "/api/accounts/tier-lock"], handler.Requests.Skip(2).Select(x => x.RequestUri!.AbsolutePath).ToArray());
    var tierBody = JsonSerializer.Deserialize<JsonElement>(handler.Bodies.Last()!);
    Equal(JsonValueKind.Null, tierBody.GetProperty("tier").ValueKind);
}

static Task Formatting()
{
    Equal("82%", BarFormatting.QuotaLabel(82.4, "ok"));
    Equal("no quota", BarFormatting.QuotaLabel(null, "unsupported"));
    Equal("$2.6k", BarFormatting.Money(2600));
    Equal("1.2k", BarFormatting.Count(1200));
    var rows = new[]
    {
        Row("pool", "agy", subscription: false),
        Row("named", "codex", profile: "work", surface: "ccsx", subscription: true),
        Row("default", "codex", profile: "default", surface: "ccsx", subscription: true, isDefault: true),
    };
    var partition = BarRows.Partition(rows);
    Equal(["named", "default"], partition.Subscriptions.Select(x => x.AccountId).ToArray());
    Equal("default", BarRows.Lead(rows)!.AccountId);
    Equal("ccsx", BarRows.AccountTitle(rows[2]));
    Equal("ccsx", BarRows.AccountTag(rows[1]));
    Equal("pool", BarRows.Lead([rows[1], rows[0]])!.AccountId);
    return Task.CompletedTask;
}

static Task Quota()
{
    Equal(QuotaBand.Green, BarQuota.Band(51, "ok"));
    Equal(QuotaBand.Red, BarQuota.Band(10, "ok"));
    Equal(.82, BarQuota.FillFraction(82, "ok"));
    Equal("3h 12m", BarQuota.CompactDuration(192));
    var now = DateTimeOffset.Parse("2026-08-24T00:00:00Z");
    Equal("resets in 3h 12m", BarQuota.ResetCountdown("2026-08-24T03:12:00Z", now));
    Equal(192, BarQuota.BurnMinutesRemaining(50, now.AddMinutes(192), 384, now));
    var windows = new[] { new QuotaWindowDetail("7d", "7 days", 30, 70, null, 10080), new QuotaWindowDetail("5h", "5 hours", 80, 20, null, 300) };
    Equal("5h", BarQuota.SelectBindingWindow(windows)!.Key);
    return Task.CompletedTask;
}

static Task Preferences()
{
    var defaults = BarPreferencesCodec.Decode(new Dictionary<string, object?>());
    Equal([20, 10, 0], defaults.QuotaLevels.ToArray());
    Equal(BarGlanceMode.Auto, defaults.GlanceMode);
    var decoded = BarPreferencesCodec.Decode(new Dictionary<string, object?> { [BarPreferenceKeys.QuotaLevels] = "40, bad, 10, 40, -1, 101", [BarPreferenceKeys.GlanceMode] = "monthSpend" });
    Equal([100, 40, 10, 0], decoded.QuotaLevels.ToArray());
    Equal(BarGlanceMode.MonthSpend, decoded.GlanceMode);
    Equal("100,40,10,0", BarPreferencesCodec.Encode(decoded)[BarPreferenceKeys.QuotaLevels]);
    return Task.CompletedTask;
}

static Task Semver()
{
    True(BarUpdate.IsNewer("1.10.0", "1.9.9"));
    False(BarUpdate.IsNewer("1.0.0-beta.2", "1.0.0"));
    False(BarUpdate.IsNewer("bad", "1.0.0"));
    return Task.CompletedTask;
}

static BarSummaryRow Row(string id, string provider, string? profile = null, string? surface = null, bool? subscription = null, bool isDefault = false) =>
    new(id, provider, null, null, false, null, "unsupported", null, isDefault, null, null, "ok", false, null, false, surface, profile, subscription, null, null);

static void True(bool value) { if (!value) throw new Exception("Expected true"); }
static void False(bool value) { if (value) throw new Exception("Expected false"); }
static void Equal<T>(T expected, T actual)
{
    if (expected is System.Collections.IEnumerable e && actual is System.Collections.IEnumerable a && expected is not string)
    {
        if (!e.Cast<object?>().SequenceEqual(a.Cast<object?>())) throw new Exception($"Expected [{string.Join(",", e.Cast<object?>())}], got [{string.Join(",", a.Cast<object?>())}]");
        return;
    }
    if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new Exception($"Expected {expected}, got {actual}");
}

sealed class RecordingHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
{
    public List<HttpRequestMessage> Requests { get; } = [];
    public List<string?> Bodies { get; } = [];
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Requests.Add(request);
        Bodies.Add(request.Content?.ReadAsStringAsync(cancellationToken).GetAwaiter().GetResult());
        return Task.FromResult(respond(request));
    }
}
