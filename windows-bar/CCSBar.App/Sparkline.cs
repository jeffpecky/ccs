using System.Windows;
using System.Windows.Media;
using CCSBar.Core;
using Point = System.Windows.Point;
using Brush = System.Windows.Media.Brush;
using Brushes = System.Windows.Media.Brushes;
using Pen = System.Windows.Media.Pen;

namespace CCSBar.App;

/// <summary>
/// Port of macos-bar Sparkline.swift: a compact spend chart with two render
/// styles. <see cref="SpendChartStyle.Bars"/> draws rounded bars (zero values as
/// faint placeholders so the cadence stays readable); <see cref="SpendChartStyle.Line"/>
/// draws a polyline stroked ~1.5 DIP with a subtle accent area fill (~15% opacity),
/// falling back to a faint flat baseline when there are fewer than two points or
/// every value is zero.
/// </summary>
public sealed class Sparkline : FrameworkElement
{
    public const double BarGap = 3;
    public const double Corner = 2;
    public const double MinBarHeight = 2;
    public const double StrokeWidth = 1.5;
    public const double AreaFillOpacity = 0.15;
    public const double BaselineOpacity = 0.2;
    public const double PlaceholderOpacity = 0.2;

    public double[] Values { get; set; } = [];
    public SpendChartStyle ChartStyle { get; set; }

    protected override void OnRender(DrawingContext dc)
    {
        base.OnRender(dc);
        if (ActualWidth <= 0 || ActualHeight <= 0) return;
        var accent = TryFindResource("AccentBrush") as Brush ?? Brushes.DimGray;
        if (ChartStyle == SpendChartStyle.Line)
        {
            if (IsBaseline(Values))
            {
                var hairline = new Pen(accent, 1);
                hairline.Freeze();
                dc.DrawLine(hairline, new Point(0, ActualHeight), new Point(ActualWidth, ActualHeight));
                return;
            }
            var points = LineGeometry(Values, ActualWidth, ActualHeight);
            var fill = new StreamGeometry();
            using (var context = fill.Open())
            {
                context.BeginFigure(new Point(points[0].X, ActualHeight), true, true);
                foreach (var point in points) context.LineTo(point, true, false);
                context.LineTo(new Point(points[^1].X, ActualHeight), true, false);
            }
            fill.Freeze();
            var fillBrush = new SolidColorBrush(((SolidColorBrush)accent).Color) { Opacity = AreaFillOpacity };
            dc.DrawGeometry(fillBrush, null, fill);
            var stroke = new StreamGeometry();
            using (var context = stroke.Open())
            {
                context.BeginFigure(points[0], false, false);
                foreach (var point in points.Skip(1)) context.LineTo(point, true, false);
            }
            stroke.Freeze();
            var pen = new Pen(accent, StrokeWidth);
            pen.Freeze();
            dc.DrawGeometry(null, pen, stroke);
        }
        else
        {
            Brush? placeholder = null;
            foreach (var bar in BarGeometry(Values, ActualWidth, ActualHeight))
            {
                Brush brush;
                if (bar.Placeholder)
                {
                    placeholder ??= new SolidColorBrush(((SolidColorBrush)(TryFindResource("MutedBrush") ?? Brushes.Gray)).Color) { Opacity = PlaceholderOpacity };
                    brush = placeholder;
                }
                else brush = accent;
                dc.DrawRoundedRectangle(brush, null, new Rect(bar.X, ActualHeight - bar.Height, bar.Width, bar.Height), Corner, Corner);
            }
        }
    }

    public readonly record struct SparklineBar(double X, double Width, double Height, bool Placeholder);

    /// <summary>Bar layout mirroring the SwiftUI HStack(spacing: 3) of rounded bars.</summary>
    public static IReadOnlyList<SparklineBar> BarGeometry(double[] values, double width, double height)
    {
        var peak = Math.Max(values.Length == 0 ? 0 : values.Max(), 0.0001);
        var count = values.Length;
        var barWidth = count == 0 ? 0 : Math.Max(1d, (width - BarGap * (count - 1)) / count);
        var rects = new List<SparklineBar>(count);
        for (var i = 0; i < count; i++)
        {
            var barHeight = Math.Max(MinBarHeight, values[i] / peak * height);
            rects.Add(new SparklineBar(i * (barWidth + BarGap), barWidth, barHeight, values[i] <= 0));
        }
        return rects;
    }

    /// <summary>Polyline points: x evenly spaced across width, y inverted so a larger value is higher.</summary>
    public static Point[] LineGeometry(double[] values, double width, double height)
    {
        var peak = Math.Max(values.Length == 0 ? 0 : values.Max(), 0.0001);
        var count = values.Length;
        return Enumerable.Range(0, count).Select(i => new Point(
            count == 1 ? width / 2 : (double)i / (count - 1) * width,
            height - values[i] / peak * height)).ToArray();
    }

    /// <summary>True when the line style must fall back to a flat baseline.</summary>
    public static bool IsBaseline(double[] values) => values.Length < 2 || Array.TrueForAll(values, v => v <= 0);
}

/// <summary>
/// Axis tick placement for the spend chart, mirroring BarAnalyticsView.axisTicks:
/// each tick sits at its data point's bar-center fraction so labels align under
/// the hour/day they name.
/// </summary>
public static class SpendAxis
{
    public static IReadOnlyList<(string Label, double Fraction)> Ticks(SpendPeriod period,
        IReadOnlyList<BarAnalyticsHour> byHour, IReadOnlyList<BarAnalyticsDay> byDay)
    {
        static double Center(int index, int count) => count > 0 ? (index + 0.5d) / count : 0;
        switch (period)
        {
            case SpendPeriod.Today:
                var hours = byHour;
                if (hours.Count == 0) return [];
                return [.. new[] { 0, 6, 12, 18, 23 }
                    .Where(index => index < hours.Count)
                    .Select(index => (Label: BarCardFormatting.HourShort(hours[index].Hour), Fraction: Center(index, hours.Count)))
                    .Where(tick => tick.Label is not null)
                    .Select(tick => (tick.Label!, tick.Fraction))];
            case SpendPeriod.Last7d:
                var days = byDay.TakeLast(7).ToArray();
                if (days.Length == 0) return [];
                return [.. days.Select((day, i) => (Label: BarCardFormatting.WeekdayShort(day.Date), Fraction: Center(i, days.Length)))
                    .Where(tick => tick.Label is not null)
                    .Select(tick => (tick.Label!, tick.Fraction))];
            default:
                var all = byDay;
                if (all.Count < 2) return [];
                var last = all.Count - 1;
                var indices = new List<int>();
                foreach (var index in new[] { 0, last / 4, last / 2, last * 3 / 4, last })
                    if (indices.Count == 0 || indices[^1] != index) indices.Add(index);
                return [.. indices
                    .Select(index => (Label: BarCardFormatting.MonthDayShort(all[index].Date), Fraction: Center(index, all.Count)))
                    .Where(tick => tick.Label is not null)
                    .Select(tick => (tick.Label!, tick.Fraction))];
        }
    }
}
