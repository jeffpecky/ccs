namespace CCSBar.Core;

public enum BarAlertKind { QuotaRemainingBelow, DailySpendAbove, MonthSpendAbove, ReauthNeeded, AccountCooldownOrPaused }
public sealed record BarNotification(string Id, string Title, string Body, BarAlertKind Kind);
public sealed record BarAlertEvaluation(IReadOnlyList<BarNotification> ToDeliver, IReadOnlySet<string> FiredKeys);

public static class BarAlertEngine
{
    public static BarAlertEvaluation Evaluate(IEnumerable<BarSummaryRow> rows, BarAnalytics? analytics, BarPreferences prefs, IEnumerable<string> priorFiredKeys, DateTimeOffset now, TimeZoneInfo? timeZone = null)
    {
        var localNow = TimeZoneInfo.ConvertTime(now, timeZone ?? TimeZoneInfo.Local);
        var list = rows.OrderBy(x => x.Id, StringComparer.Ordinal).ToList(); var prior = priorFiredKeys.ToHashSet(StringComparer.Ordinal); var fired = new HashSet<string>(StringComparer.Ordinal); var output = new List<BarNotification>();
        void Add(string key, string title, string body, BarAlertKind kind) { fired.Add(key); if (!prior.Contains(key)) output.Add(new(key, title, body, kind)); }
        foreach (var row in list)
        {
            var name = row.DisplayName ?? row.Provider;
            if (prefs.QuotaEnabled && row.QuotaStatus == "ok" && row.QuotaPercentage is { } pct)
            {
                var rounded = Math.Round(pct, MidpointRounding.AwayFromZero);
                var crossed = prefs.QuotaLevels.Where(x => rounded <= x).OrderBy(x => x).ToArray();
                if (crossed.Length > 0) Add($"quotaRemainingBelow|{row.Id}|{row.NextReset ?? "noreset"}|L{crossed[0]}", "Quota low", $"{name} has {rounded}% remaining", BarAlertKind.QuotaRemainingBelow);
            }
            if (prefs.ReauthEnabled && row.NeedsReauth) Add($"reauthNeeded|{row.Id}|on", "Re-authentication needed", $"{name} needs sign-in", BarAlertKind.ReauthNeeded);
            if (prefs.CooldownPausedEnabled && row.Paused) Add($"accountCooldownOrPaused|{row.Id}|on", "Account paused", $"{name} is paused", BarAlertKind.AccountCooldownOrPaused);
        }
        if (prefs.DailySpendEnabled && analytics?.Today.Cost > prefs.DailyCapUsd) Add($"dailySpendAbove|global|{localNow:yyyy-MM-dd}", "Daily spend cap", $"Today's spend {BarFormatting.Money(analytics.Today.Cost)} is over your {BarFormatting.Money(prefs.DailyCapUsd)} cap", BarAlertKind.DailySpendAbove);
        if (prefs.MonthSpendEnabled && analytics?.MonthToDate.Cost > prefs.MonthCapUsd) Add($"monthSpendAbove|global|{localNow:yyyy-MM}", "Monthly spend cap", $"This month's spend {BarFormatting.Money(analytics.MonthToDate.Cost)} is over your {BarFormatting.Money(prefs.MonthCapUsd)} cap", BarAlertKind.MonthSpendAbove);
        return new(output, fired);
    }
}
