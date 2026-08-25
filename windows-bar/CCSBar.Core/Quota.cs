namespace CCSBar.Core;

public enum QuotaBand { Green, Yellow, Orange, Red, None }

public static class BarQuota
{
    public static QuotaBand Band(double? percentage, string status) => status != "ok" || percentage is null ? QuotaBand.None : percentage switch
    {
        > 50 => QuotaBand.Green,
        > 20 => QuotaBand.Yellow,
        > 10 => QuotaBand.Orange,
        _ => QuotaBand.Red,
    };
    public static double? FillFraction(double? percentage, string status) => status == "ok" && percentage is not null ? Math.Clamp(percentage.Value / 100, 0, 1) : null;
    public static string? ResetCountdown(string? nextReset, DateTimeOffset now) => DateTimeOffset.TryParse(nextReset, out var reset)
        ? reset <= now ? "resets soon" : $"resets in {CompactDuration((int)(reset - now).TotalMinutes)}"
        : null;
    public static int? BurnMinutesRemaining(double usedPercent, DateTimeOffset? resetAt, int? windowMinutes, DateTimeOffset now)
    {
        if (resetAt is null || windowMinutes is null) return null;
        var elapsed = windowMinutes.Value - Math.Max(0, (resetAt.Value - now).TotalMinutes);
        if (elapsed <= 0) return null;
        if (usedPercent >= 100) return 0;
        if (usedPercent <= 1) return null;
        return (int)((100 - usedPercent) * elapsed / usedPercent);
    }
    public static QuotaWindowDetail? SelectBindingWindow(IEnumerable<QuotaWindowDetail> windows) => windows
        .OrderBy(x => x.RemainingPercent)
        .ThenBy(x => x.WindowMinutes ?? int.MaxValue)
        .ThenBy(x => KeyRank(x.Key))
        .FirstOrDefault();
    public static IReadOnlyList<QuotaWindowDetail> OrderedWindows(IEnumerable<QuotaWindowDetail> windows) => windows
        .OrderBy(x => KeyRank(x.Key))
        .ToArray();
    public static string? PaceWarning(double usedPercent, double remainingPercent, string? resetAt, int? windowMinutes, DateTimeOffset now)
    {
        var clause = PaceClause(usedPercent, remainingPercent, resetAt, windowMinutes, now);
        return clause is not null && clause.StartsWith('~') ? $"⚠ {clause.Replace(" left at this pace", "")}" : null;
    }
    public static string? PaceClause(double usedPercent, double remainingPercent, string? resetAt, int? windowMinutes, DateTimeOffset now)
    {
        if (usedPercent >= 100 || remainingPercent <= 0) return ResetCountdown(resetAt, now) is { } reset ? $"limit reached, {reset}" : "limit reached";
        if (DateTimeOffset.TryParse(resetAt, out var resetDate) && resetDate <= now) return null;
        var burn = BurnMinutesRemaining(usedPercent, DateTimeOffset.TryParse(resetAt, out resetDate) ? resetDate : null, windowMinutes, now);
        if (remainingPercent >= 85 || burn is null) return windowMinutes is not null && resetAt is not null ? "plenty at this pace" : null;
        if (burn < 5) return ResetCountdown(resetAt, now) is { } reset ? $"limit reached, {reset}" : "limit reached";
        if (!DateTimeOffset.TryParse(resetAt, out resetDate) || burn >= (resetDate - now).TotalMinutes) return null;
        return $"~{CompactDuration(burn.Value)} left at this pace";
    }
    public static (string Label, double RemainingPercent)? HeadroomLeader(IEnumerable<BarSummaryRow> rows)
    {
        var eligible = rows.Select(x => (Label: x.DisplayName ?? x.Provider, Window: SelectBindingWindow(x.QuotaWindows ?? []))).Where(x => x.Window is not null).Select(x => (x.Label, x.Window!.RemainingPercent)).ToList();
        if (eligible.Count < 2) return null;
        return eligible.OrderByDescending(x => x.RemainingPercent).ThenBy(x => x.Label, StringComparer.Ordinal).First();
    }
    public static string CompactDuration(int minutes)
    {
        var hours = minutes / 60;
        return hours >= 24 ? $"{hours / 24}d {hours % 24}h" : hours > 0 ? $"{hours}h {minutes % 60}m" : $"{minutes % 60}m";
    }
    private static int KeyRank(string key) => key switch { "five_hour" => 0, "seven_day" => 1, "seven_day_opus" => 2, "seven_day_sonnet" => 3, _ => 4 };
}
