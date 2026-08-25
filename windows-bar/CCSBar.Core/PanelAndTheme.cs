namespace CCSBar.Core;

public readonly record struct BarRect(double X, double Y, double Width, double Height)
{
    public double Right => X + Width;
    public double Bottom => Y + Height;
}

public static class PanelPlacement
{
    public static BarRect Anchor(BarRect work, BarRect tray, double width, double height)
    {
        var gap = 8d;
        height = Math.Min(height, work.Height);
        var x = Math.Clamp(tray.X + tray.Width - width, work.X, work.Right - width);
        var above = tray.Y - height - gap;
        var below = tray.Bottom + gap;
        var y = above >= work.Y ? above : Math.Clamp(below, work.Y, work.Bottom - height);
        return new(x, y, width, height);
    }
}

/// <summary>
/// Exact port of BarTheme.swift palette values.
/// Dark values from lines 57-65, Light values from lines 71-79 of BarTheme.swift.
/// </summary>
public sealed record BarThemePalette(
    string Accent,
    string Subscription,
    string Green,
    string Amber,
    string Coral,
    string Red,
    string WindowSurface,
    string CardSurface,
    string BarTrack,
    string Text,
    string Muted,
    string Border
)
{
    // Dark mode - exact values from BarTheme.swift
    public static BarThemePalette Dark { get; } = new(
        Accent: "#E2732A",           // RGB(0.886, 0.451, 0.137)
        Subscription: "#5B63D9",     // RGB(0.357, 0.388, 0.851)
        Green: "#5CBC8F",            // RGB(0.36, 0.74, 0.56)
        Amber: "#DBAB4F",            // RGB(0.86, 0.67, 0.31)
        Coral: "#E8755C",            // RGB(0.91, 0.46, 0.36)
        Red: "#D9564F",              // RGB(0.85, 0.34, 0.31)
        WindowSurface: "#202124",    // Dark window plate
        CardSurface: "#2B2C2F",      // Color.primary.opacity(0.05) on dark ≈ #2B2C2F
        BarTrack: "#45464A",         // Color.primary.opacity(0.12) on dark ≈ #45464A
        Text: "#F2F2F2",             // Primary text on dark
        Muted: "#A8A8AC",            // Secondary text on dark
        Border: "#404044"            // Border on dark
    );

    // Light mode - exact values from BarTheme.swift
    public static BarThemePalette Light { get; } = new(
        Accent: "#CF5B10",           // RGB(0.812, 0.357, 0.063)
        Subscription: "#464DBE",     // RGB(0.275, 0.302, 0.745)
        Green: "#1B945B",            // RGB(0.106, 0.580, 0.357)
        Amber: "#B87D0B",            // RGB(0.722, 0.490, 0.043)
        Coral: "#D44D28",            // RGB(0.831, 0.302, 0.157)
        Red: "#C62823",              // RGB(0.776, 0.157, 0.137)
        WindowSurface: "#F5F5F7",    // RGB(0.961, 0.961, 0.969)
        CardSurface: "#EAEAED",      // Color.primary.opacity(0.05) on light ≈ #EAEAED
        BarTrack: "#D6D6DA",         // Color.primary.opacity(0.12) on light ≈ #D6D6DA
        Text: "#1D1D1F",             // Primary text on light
        Muted: "#68686C",            // Secondary text on light
        Border: "#D7D7DB"            // Border on light
    );
}

/// <summary>
/// Design token keys for resource dictionary lookups.
/// Matches BarTheme.swift token structure.
/// </summary>
public static class BarThemeKeys
{
    // Color tokens
    public const string AccentBrush = "AccentBrush";
    public const string SubscriptionBrush = "SubscriptionBrush";
    public const string GreenBrush = "GreenBrush";
    public const string AmberBrush = "AmberBrush";
    public const string CoralBrush = "CoralBrush";
    public const string RedBrush = "RedBrush";
    public const string WindowBrush = "WindowBrush";
    public const string CardBrush = "CardBrush";
    public const string TrackBrush = "TrackBrush";
    public const string TextBrush = "TextBrush";
    public const string MutedBrush = "MutedBrush";
    public const string BorderBrush = "BorderBrush";

    // Typography tokens
    public const string FontFamilyUI = "FontFamily.UI";
    public const string FontFamilyMono = "FontFamily.Mono";
    public const string FontSizeHeadline = "FontSize.Headline";
    public const string FontSizeBody = "FontSize.Body";
    public const string FontSizeCaption = "FontSize.Caption";
    public const string FontSizeCaption2 = "FontSize.Caption2";
    public const string FontSizeSectionLabel = "FontSize.SectionLabel";
    public const string FontWeightRegular = "FontWeight.Regular";
    public const string FontWeightMedium = "FontWeight.Medium";
    public const string FontWeightSemibold = "FontWeight.Semibold";
    public const string FontWeightBold = "FontWeight.Bold";

    // Spacing tokens (matching SwiftUI usage: 4,5,6,7,8,10,11,12,14)
    public const string Spacing4 = "Spacing.4";
    public const string Spacing5 = "Spacing.5";
    public const string Spacing6 = "Spacing.6";
    public const string Spacing7 = "Spacing.7";
    public const string Spacing8 = "Spacing.8";
    public const string Spacing10 = "Spacing.10";
    public const string Spacing11 = "Spacing.11";
    public const string Spacing12 = "Spacing.12";
    public const string Spacing14 = "Spacing.14";

    // Radius tokens
    public const string RadiusSmall = "Radius.Small";    // 4-5 (chips, bar track)
    public const string RadiusMedium = "Radius.Medium";  // 8-9 (cards)
    public const string RadiusLarge = "Radius.Large";    // 12 (window)

    // Shadow tokens
    public const string PanelShadow = "PanelShadow";
    public const string CardShadow = "CardShadow";

    // Control template keys
    public const string CcsButtonTemplate = "CcsButtonTemplate";
    public const string CcsChipTemplate = "CcsChipTemplate";
    public const string CcsCheckBoxTemplate = "CcsCheckBoxTemplate";
    public const string CcsComboBoxTemplate = "CcsComboBoxTemplate";
    public const string CcsProgressBarTemplate = "CcsProgressBarTemplate";
    public const string CcsMenuItemTemplate = "CcsMenuItemTemplate";
    public const string CcsScrollBarTemplate = "CcsScrollBarTemplate";
    public const string CcsSeparatorTemplate = "CcsSeparatorTemplate";
    public const string CcsToolTipTemplate = "CcsToolTipTemplate";
}