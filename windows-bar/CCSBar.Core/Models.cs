using System.Text.Json;
using System.Text.Json.Serialization;

namespace CCSBar.Core;

public static class BarJson
{
    public static JsonSerializerOptions Options { get; } = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = false,
    };
}

public sealed record QuotaWindowDetail(
    string Key,
    string Label,
    double UsedPercent,
    double RemainingPercent,
    string? ResetAt = null,
    int? WindowMinutes = null);

public sealed record BarSummaryRow(
    [property: JsonPropertyName("account_id")] string AccountId,
    string Provider,
    string? DisplayName = null,
    string? Tier = null,
    bool Paused = false,
    [property: JsonPropertyName("quota_percentage")] double? QuotaPercentage = null,
    string QuotaStatus = "error",
    [property: JsonPropertyName("next_reset")] string? NextReset = null,
    [property: JsonPropertyName("is_default")] bool IsDefault = false,
    [property: JsonPropertyName("last_activity_at")] string? LastActivityAt = null,
    [property: JsonPropertyName("today_cost")] double? TodayCost = null,
    string Health = "ok",
    bool Cached = false,
    string? FetchedAt = null,
    bool NeedsReauth = false,
    string? Surface = null,
    string? Profile = null,
    [property: JsonPropertyName("is_subscription")] bool? IsSubscription = null,
    [property: JsonPropertyName("quota_windows")] IReadOnlyList<QuotaWindowDetail>? QuotaWindows = null,
    [property: JsonPropertyName("stale_as_of")] string? StaleAsOf = null)
{
    [JsonIgnore] public string Id => $"{Provider}:{AccountId}";
    [JsonIgnore] public string HealthDot => Health switch { "error" => "X", "warning" => "!", _ => "OK" };
}

public sealed record BarAnalyticsWindow(double Cost = 0, int Requests = 0);
public sealed record BarAnalyticsDay(string Date, double Cost, int Requests);
public sealed record BarAnalyticsHour(string Hour, double Cost, int Requests);
public sealed record BarAnalyticsModel(string Model, double Cost, int Requests);
public sealed record BarAnalyticsSurface(string Source, string Surface, double Cost, int Requests);

public sealed class BarAnalytics
{
    public BarAnalyticsWindow Today { get; init; } = new();
    public BarAnalyticsWindow Last7d { get; init; } = new();
    public BarAnalyticsWindow Last30d { get; init; } = new();
    public BarAnalyticsWindow MonthToDate { get; init; } = new();
    public BarAnalyticsWindow AllTime { get; init; } = new();
    public IReadOnlyList<BarAnalyticsDay> ByDay { get; init; } = [];
    public IReadOnlyList<BarAnalyticsHour> ByHour { get; init; } = [];
    public IReadOnlyList<BarAnalyticsModel> TopModels { get; init; } = [];
    public string TopModelsWindow { get; init; } = "";
    public string? LastActivityAt { get; init; }
    public int? DaysSinceLastActivity { get; init; }
    public bool HasRecentData { get; init; }
    public string GeneratedAt { get; init; } = "";
    public IReadOnlyList<BarAnalyticsSurface> BySurface { get; init; } = [];
}
