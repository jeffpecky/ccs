using System.Globalization;

namespace CCSBar.Core;

public static class BarFormatting
{
    public static string QuotaLabel(double? percentage, string status) => status switch
    {
        "ok" when percentage is not null => $"{Math.Round(percentage.Value, MidpointRounding.AwayFromZero):0}%",
        "unsupported" => "no quota",
        _ => "quota ?",
    };

    public static string? QuotaTitleToken(double? percentage, string status) => status == "ok" && percentage is not null ? QuotaLabel(percentage, status) : null;
    public static string CostLabel(double? cost) => cost is > 0 ? cost.Value.ToString("$0.00", CultureInfo.InvariantCulture) : "";
    public static string Money(double value) => Math.Max(0, value) switch
    {
        >= 1_000_000 and var n => $"${n / 1_000_000:0.0}M",
        >= 1_000 and var n => $"${n / 1_000:0.0}k",
        var n => n.ToString("$0.00", CultureInfo.InvariantCulture),
    };
    public static string Count(int value) => value switch
    {
        >= 1_000_000 => $"{value / 1_000_000d:0.0}M",
        >= 1_000 => $"{value / 1_000d:0.0}k",
        _ => value.ToString(CultureInfo.InvariantCulture),
    };
    public static string StatusTitle(IEnumerable<BarSummaryRow> rows, BarAnalytics? analytics, BarGlanceMode mode = BarGlanceMode.Auto)
    {
        var list = rows.ToList();
        string Auto()
        {
            if (list.Count == 0) return "CCS";
            var quota = list.Where(x => x.QuotaStatus == "ok" && x.QuotaPercentage is not null).MinBy(x => x.QuotaPercentage);
            if (quota is not null) return $"{quota.Provider} {QuotaTitleToken(quota.QuotaPercentage, quota.QuotaStatus)}";
            if (analytics?.Today.Cost > 0) return Money(analytics.Today.Cost);
            var reauth = list.Count(x => x.NeedsReauth);
            if (reauth > 0) return $"CCS {reauth}!";
            var active = list.Count(x => !x.Paused);
            return $"CCS {(active > 0 ? active : list.Count)}";
        }
        return mode switch
        {
            BarGlanceMode.TodaySpend when analytics?.Today.Cost > 0 => Money(analytics.Today.Cost),
            BarGlanceMode.MonthSpend when analytics?.MonthToDate.Cost > 0 => Money(analytics.MonthToDate.Cost),
            BarGlanceMode.LowestQuota => list.Where(x => x.QuotaStatus == "ok" && x.QuotaPercentage is not null).MinBy(x => x.QuotaPercentage) is { } q ? $"{q.Provider} {QuotaTitleToken(q.QuotaPercentage, q.QuotaStatus)}" : Auto(),
            BarGlanceMode.AccountCount when list.Count > 0 => $"CCS {(list.Count(x => !x.Paused) is > 0 and var n ? n : list.Count)}",
            _ => Auto(),
        };
    }
    public static string? LastActiveLabel(string? iso, int? daysSince, DateTimeOffset now)
    {
        if (!DateTimeOffset.TryParse(iso, out var date)) return null;
        daysSince ??= Math.Max(0, (now.Date - date.ToOffset(now.Offset).Date).Days);
        if (daysSince <= 0) return "Last active today";
        if (daysSince == 1) return "Last active yesterday";
        return $"Last active {date.ToString("MMM d", CultureInfo.InvariantCulture)}";
    }
}

public sealed class RefreshDebouncer(TimeSpan? interval = null)
{
    readonly TimeSpan interval = interval ?? TimeSpan.FromSeconds(15); DateTimeOffset? lastArmed;
    public bool ShouldRefresh(DateTimeOffset now) { if (lastArmed is not null && now - lastArmed < interval) return false; lastArmed = now; return true; }
}

public static class BarCardFormatting
{
    public static string? ShortReset(string? iso, DateTimeOffset now)
    {
        if (!DateTimeOffset.TryParse(iso, out var date)) return null;
        var seconds = (date - now).TotalSeconds;
        if (seconds <= 0) return "due";
        var minutes = (int)(seconds / 60);
        if (minutes < 24 * 60) return BarQuota.CompactDuration(minutes);
        return date.ToString(minutes < 7 * 24 * 60 ? "ddd" : "MMM d", CultureInfo.InvariantCulture);
    }
    public static string? ClockTime(string? iso) => DateTimeOffset.TryParse(iso, out var date)
        ? date.ToString("HH:mm", CultureInfo.InvariantCulture)
        : null;

    // Axis label formatters for the spend chart, mirroring macOS BarCardFormatting.

    /// <summary>Short hour label from a byHour key "YYYY-MM-DD HH:00", e.g. "12a", "6p".</summary>
    public static string? HourShort(string? key)
    {
        if (key is null || key.Length < 13 || key[10] != ' ') return null;
        if (!int.TryParse(key.AsSpan(11, 2), out var hour)) return null;
        return hour switch
        {
            0 => "12a",
            < 12 => $"{hour}a",
            12 => "12p",
            _ => $"{hour - 12}p",
        };
    }

    /// <summary>Short weekday label from a byDay key "YYYY-MM-DD", e.g. "Mon".</summary>
    public static string? WeekdayShort(string? key) => DayKey(key)?.ToString("ddd", CultureInfo.InvariantCulture);

    /// <summary>Short month+day label from a byDay key "YYYY-MM-DD", e.g. "Jun 5".</summary>
    public static string? MonthDayShort(string? key) => DayKey(key)?.ToString("MMM d", CultureInfo.InvariantCulture);

    static DateTime? DayKey(string? key) => DateTime.TryParseExact(key, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) ? date : null;
}

public static class BarRows
{
    public static bool IsNativeSubscription(BarSummaryRow row) => row.IsSubscription ??
        row.Provider == "claude-code" && row.AccountId == "claude-code" || row.Provider == "codex" && row.AccountId == "codex";
    public static bool IsBaseAccount(BarSummaryRow row) => row.Profile == "default";
    public static string ProviderLabel(string provider) => provider switch { "claude-code" => "Claude Code", "codex" => "Codex", _ => provider };
    public static string AccountTitle(BarSummaryRow row) => IsBaseAccount(row) ? row.Surface ?? ProviderLabel(row.Provider) : row.Profile ?? ProviderLabel(row.Provider);
    public static string? AccountTag(BarSummaryRow row) => row.Profile is null ? null : IsBaseAccount(row) ? "default" : row.Surface ?? row.Provider;
    public static string? SurfaceProfileLabel(BarSummaryRow row) => row.Profile is null ? null : $"{row.Surface ?? row.Provider} · {row.Profile}";
    public static BarSummaryRow? Lead(IEnumerable<BarSummaryRow> rows)
    {
        var list = rows.ToList();
        return list.FirstOrDefault(x => x.IsDefault) ?? (list.Count(x => !x.Paused) == 1 ? list.Single(x => !x.Paused) : list.OrderBy(x => x.Id, StringComparer.Ordinal).FirstOrDefault());
    }
    public static (IReadOnlyList<BarSummaryRow> Subscriptions, IReadOnlyList<BarSummaryRow> Pool) Partition(IEnumerable<BarSummaryRow> rows)
    {
        var subscriptions = new List<BarSummaryRow>();
        var pool = new List<BarSummaryRow>();
        foreach (var row in rows) (IsNativeSubscription(row) ? subscriptions : pool).Add(row);
        return (subscriptions, pool);
    }
    public static IReadOnlyList<BarSummaryRow> OrderSubscriptions(IEnumerable<BarSummaryRow> subscriptions) => subscriptions
        .OrderByDescending(x => x.IsDefault)
        .ThenBy(x => BarQuota.SelectBindingWindow(x.QuotaWindows ?? []) is { } binding ? binding.RemainingPercent : double.MaxValue)
        .ThenBy(x => x.DisplayName ?? x.Provider, StringComparer.Ordinal)
        .ThenBy(x => x.Id, StringComparer.Ordinal)
        .ToArray();
}
