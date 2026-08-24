using System.Globalization;
using System.Net;
using System.Text.RegularExpressions;

namespace CCSBar.Core;

public enum BarGlanceMode { Auto, TodaySpend, MonthSpend, LowestQuota, AccountCount }

public static class BarPreferenceKeys
{
    public const string QuotaEnabled = "ccsbar.alert.quota.enabled";
    public const string QuotaLevels = "ccsbar.alert.quota.levels";
    public const string DailyEnabled = "ccsbar.alert.daily.enabled";
    public const string DailyCapUsd = "ccsbar.alert.daily.capUSD";
    public const string MonthEnabled = "ccsbar.alert.month.enabled";
    public const string MonthCapUsd = "ccsbar.alert.month.capUSD";
    public const string ReauthEnabled = "ccsbar.alert.reauth.enabled";
    public const string CooldownPausedEnabled = "ccsbar.alert.cooldownPaused.enabled";
    public const string GlanceMode = "ccsbar.glance.mode";
    public const string FiredKeys = "ccsbar.alert.firedKeys";
}

public sealed record BarPreferences(
    bool QuotaEnabled = true,
    IReadOnlyList<int>? QuotaLevelsValue = null,
    bool DailySpendEnabled = true,
    double DailyCapUsd = 500,
    bool MonthSpendEnabled = true,
    double MonthCapUsd = 10000,
    bool ReauthEnabled = true,
    bool CooldownPausedEnabled = true,
    BarGlanceMode GlanceMode = BarGlanceMode.Auto)
{
    public IReadOnlyList<int> QuotaLevels => QuotaLevelsValue ?? [20, 10, 0];
}

public static class BarPreferencesCodec
{
    public static BarPreferences Decode(IReadOnlyDictionary<string, object?> values)
    {
        var d = new BarPreferences();
        var levels = values.TryGetValue(BarPreferenceKeys.QuotaLevels, out var raw) && raw is string text ? ParseLevels(text) : d.QuotaLevels;
        if (levels.Count == 0) levels = d.QuotaLevels;
        var mode = values.TryGetValue(BarPreferenceKeys.GlanceMode, out raw) && raw is string modeText ? ParseMode(modeText) : d.GlanceMode;
        return new(
            Bool(values, BarPreferenceKeys.QuotaEnabled, d.QuotaEnabled), levels,
            Bool(values, BarPreferenceKeys.DailyEnabled, d.DailySpendEnabled), Double(values, BarPreferenceKeys.DailyCapUsd, d.DailyCapUsd),
            Bool(values, BarPreferenceKeys.MonthEnabled, d.MonthSpendEnabled), Double(values, BarPreferenceKeys.MonthCapUsd, d.MonthCapUsd),
            Bool(values, BarPreferenceKeys.ReauthEnabled, d.ReauthEnabled), Bool(values, BarPreferenceKeys.CooldownPausedEnabled, d.CooldownPausedEnabled), mode);
    }
    public static Dictionary<string, object> Encode(BarPreferences value) => new()
    {
        [BarPreferenceKeys.QuotaEnabled] = value.QuotaEnabled,
        [BarPreferenceKeys.QuotaLevels] = string.Join(',', value.QuotaLevels.Select(x => Math.Clamp(x, 0, 100)).OrderDescending()),
        [BarPreferenceKeys.DailyEnabled] = value.DailySpendEnabled,
        [BarPreferenceKeys.DailyCapUsd] = value.DailyCapUsd,
        [BarPreferenceKeys.MonthEnabled] = value.MonthSpendEnabled,
        [BarPreferenceKeys.MonthCapUsd] = value.MonthCapUsd,
        [BarPreferenceKeys.ReauthEnabled] = value.ReauthEnabled,
        [BarPreferenceKeys.CooldownPausedEnabled] = value.CooldownPausedEnabled,
        [BarPreferenceKeys.GlanceMode] = ModeText(value.GlanceMode),
    };
    private static IReadOnlyList<int> ParseLevels(string value) => value.Split(',').Select(x => int.TryParse(x.Trim(), out var n) ? (int?)n : null).Where(x => x is not null).Select(x => Math.Clamp(x!.Value, 0, 100)).Distinct().OrderDescending().ToArray();
    private static bool Bool(IReadOnlyDictionary<string, object?> v, string key, bool fallback) => v.TryGetValue(key, out var x) && x is bool b ? b : fallback;
    private static double Double(IReadOnlyDictionary<string, object?> v, string key, double fallback)
    {
        try { return v.TryGetValue(key, out var x) && x is IConvertible c ? c.ToDouble(CultureInfo.InvariantCulture) : fallback; }
        catch (FormatException) { return fallback; } catch (InvalidCastException) { return fallback; } catch (OverflowException) { return fallback; }
    }
    private static BarGlanceMode ParseMode(string value) => value switch { "todaySpend" => BarGlanceMode.TodaySpend, "monthSpend" => BarGlanceMode.MonthSpend, "lowestQuota" => BarGlanceMode.LowestQuota, "accountCount" => BarGlanceMode.AccountCount, _ => BarGlanceMode.Auto };
    private static string ModeText(BarGlanceMode value) => value switch { BarGlanceMode.TodaySpend => "todaySpend", BarGlanceMode.MonthSpend => "monthSpend", BarGlanceMode.LowestQuota => "lowestQuota", BarGlanceMode.AccountCount => "accountCount", _ => "auto" };
}

public static partial class BarUpdate
{
    public const string ReleaseRepository = "jeffpecky/ccs";
    public static readonly Uri VersionUri = new($"https://github.com/{ReleaseRepository}/releases/download/ccs-bar-latest/version.txt");
    [GeneratedRegex(@"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$")]
    private static partial Regex SemverRegex();
    public static bool IsNewer(string latest, string current)
    {
        var left = Parse(latest); var right = Parse(current);
        if (left is null || right is null) return false;
        return left.CompareTo(right) > 0;
    }
    public static async Task<string?> FetchLatestPublishedVersionAsync(HttpClient http, CancellationToken cancellationToken = default)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken); timeout.CancelAfter(TimeSpan.FromSeconds(8));
        using var request = new HttpRequestMessage(HttpMethod.Get, VersionUri); request.Headers.CacheControl = new() { NoCache = true }; request.Options.Set(new HttpRequestOptionsKey<TimeSpan>("CCSBar.Timeout"), TimeSpan.FromSeconds(8));
        try { using var response = await http.SendAsync(request, timeout.Token); if (response.StatusCode != HttpStatusCode.OK) return null; var value = (await response.Content.ReadAsStringAsync(timeout.Token)).Trim(); return Parse(value) is null ? null : value; }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return null; } catch (HttpRequestException) { return null; }
    }
    private static SemVersion? Parse(string value) => SemverRegex().Match(value) is { Success: true } match && int.TryParse(match.Groups[1].Value, out var major) && int.TryParse(match.Groups[2].Value, out var minor) && int.TryParse(match.Groups[3].Value, out var patch) ? new(major, minor, patch, match.Groups[4].Success ? match.Groups[4].Value.Split('.') : []) : null;
    private sealed record SemVersion(int Major, int Minor, int Patch, IReadOnlyList<string> Pre) : IComparable<SemVersion>
    {
        public int CompareTo(SemVersion? other)
        {
            if (other is null) return 1;
            foreach (var pair in new[] { (Major, other.Major), (Minor, other.Minor), (Patch, other.Patch) }) if (pair.Item1 != pair.Item2) return pair.Item1.CompareTo(pair.Item2);
            if (Pre.Count == 0 || other.Pre.Count == 0) return Pre.Count == other.Pre.Count ? 0 : Pre.Count == 0 ? 1 : -1;
            for (var i = 0; i < Math.Max(Pre.Count, other.Pre.Count); i++)
            {
                if (i == Pre.Count || i == other.Pre.Count) return Pre.Count.CompareTo(other.Pre.Count);
                var aNum = int.TryParse(Pre[i], out var a); var bNum = int.TryParse(other.Pre[i], out var b);
                var comparison = aNum && bNum ? a.CompareTo(b) : aNum != bNum ? aNum ? -1 : 1 : string.CompareOrdinal(Pre[i], other.Pre[i]);
                if (comparison != 0) return comparison;
            }
            return 0;
        }
    }
}
