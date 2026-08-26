using System.Text.Json;
using System.Text.Json.Serialization;

namespace CCSBar.Core;

public static class BarJson
{
    public static JsonSerializerOptions Options { get; } = new(JsonSerializerDefaults.Web) { PropertyNameCaseInsensitive = false, UnmappedMemberHandling = JsonUnmappedMemberHandling.Skip };
}

public sealed record QuotaWindowDetail(
    [property: JsonRequired] string Key,
    [property: JsonRequired] string Label,
    [property: JsonRequired] double UsedPercent,
    [property: JsonRequired] double RemainingPercent,
    string? ResetAt = null,
    int? WindowMinutes = null);

public sealed record BarSummaryRow(
    [property: JsonPropertyName("account_id"), JsonRequired] string AccountId,
    [property: JsonRequired] string Provider,
    string? DisplayName,
    string? Tier,
    [property: JsonRequired] bool Paused,
    [property: JsonPropertyName("quota_percentage")] double? QuotaPercentage,
    [property: JsonRequired] string QuotaStatus,
    [property: JsonPropertyName("next_reset")] string? NextReset,
    [property: JsonPropertyName("is_default"), JsonRequired] bool IsDefault,
    [property: JsonPropertyName("last_activity_at")] string? LastActivityAt,
    [property: JsonPropertyName("today_cost")] double? TodayCost,
    [property: JsonRequired] string Health,
    [property: JsonRequired] bool Cached,
    string? FetchedAt,
    [property: JsonRequired] bool NeedsReauth,
    string? Surface,
    string? Profile,
    [property: JsonPropertyName("is_subscription")] bool? IsSubscription,
    [property: JsonPropertyName("quota_windows")] IReadOnlyList<QuotaWindowDetail>? QuotaWindows,
    [property: JsonPropertyName("stale_as_of")] string? StaleAsOf)
{
    [JsonIgnore] public string Id => $"{Provider}:{AccountId}";
    [JsonIgnore] public string HealthDot => Health switch { "error" => "X", "warning" => "!", _ => "OK" };
}

public sealed record BarAnalyticsWindow([property: JsonRequired] double Cost, [property: JsonRequired] int Requests);
public sealed record BarAnalyticsDay([property: JsonRequired] string Date, [property: JsonRequired] double Cost, [property: JsonRequired] int Requests);
public sealed record BarAnalyticsHour([property: JsonRequired] string Hour, [property: JsonRequired] double Cost, [property: JsonRequired] int Requests);
public sealed record BarAnalyticsModel([property: JsonRequired] string Model, [property: JsonRequired] double Cost, [property: JsonRequired] int Requests);
public sealed record BarAnalyticsSurface([property: JsonRequired] string Source, [property: JsonRequired] string Surface, [property: JsonRequired] double Cost, [property: JsonRequired] int Requests);

public sealed record BarAnalytics
{
    [JsonRequired] public BarAnalyticsWindow Today { get; init; } = null!;
    [JsonRequired] public BarAnalyticsWindow Last7d { get; init; } = null!;
    [JsonRequired] public BarAnalyticsWindow Last30d { get; init; } = null!;
    public BarAnalyticsWindow MonthToDate { get; init; } = new(0, 0);
    [JsonRequired] public BarAnalyticsWindow AllTime { get; init; } = null!;
    [JsonRequired] public IReadOnlyList<BarAnalyticsDay> ByDay { get; init; } = null!;
    public IReadOnlyList<BarAnalyticsHour> ByHour { get; init; } = [];
    [JsonRequired] public IReadOnlyList<BarAnalyticsModel> TopModels { get; init; } = null!;
    [JsonRequired] public string TopModelsWindow { get; init; } = null!;
    public string? LastActivityAt { get; init; }
    public int? DaysSinceLastActivity { get; init; }
    [JsonRequired] public bool HasRecentData { get; init; }
    [JsonRequired] public string GeneratedAt { get; init; } = null!;
    public IReadOnlyList<BarAnalyticsSurface> BySurface { get; init; } = [];
}
