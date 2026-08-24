namespace CCSBar.Core;

public readonly record struct BarRect(double X, double Y, double Width, double Height)
{
    public double Right => X + Width; public double Bottom => Y + Height;
}

public static class PanelPlacement
{
    public static BarRect Anchor(BarRect work, BarRect tray, double width, double height)
    {
        var gap = 8d; height = Math.Min(height, work.Height);
        var x = Math.Clamp(tray.X + tray.Width - width, work.X, work.Right - width);
        var above = tray.Y - height - gap; var below = tray.Bottom + gap;
        var y = above >= work.Y ? above : Math.Clamp(below, work.Y, work.Bottom - height);
        return new(x, y, width, height);
    }
}

public sealed record BarThemePalette(string Accent, string Subscription, string Green, string Amber, string Coral, string Red, string WindowSurface)
{
    public static BarThemePalette Dark { get; } = new("#E2732A", "#5B63D9", "#5CBC8F", "#DBAB4F", "#E8755C", "#D9564F", "#202124");
    public static BarThemePalette Light { get; } = new("#CF5B10", "#464DBE", "#1B945B", "#B87D0B", "#D44D28", "#C62823", "#F5F5F7");
}
