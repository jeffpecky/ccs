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
    public static string CompactDuration(int minutes)
    {
        var hours = minutes / 60;
        return hours >= 24 ? $"{hours / 24}d {hours % 24}h" : hours > 0 ? $"{hours}h {minutes % 60}m" : $"{minutes % 60}m";
    }
    private static int KeyRank(string key) => key switch { "5h" => 0, "week" or "7d" => 1, "opus" => 2, "sonnet" => 3, _ => 4 };
}
