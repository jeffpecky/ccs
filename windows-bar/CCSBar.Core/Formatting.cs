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
}
