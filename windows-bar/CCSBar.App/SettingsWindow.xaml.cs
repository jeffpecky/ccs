using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using CCSBar.Core;
using Forms = System.Windows.Forms;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using Point = System.Windows.Point;
using Application = System.Windows.Application;

namespace CCSBar.App;

/// <summary>
/// Standalone settings window mirroring macOS BarPreferencesView: a real
/// resizable window (460x600, min 420x520) hosted outside the panel, themed by
/// the same Application-level token pipeline so theme picks re-render both
/// windows live. Every change writes through to the shared settings store
/// immediately — there is no separate save step — and the footer Done commits
/// pending text edits before closing.
/// </summary>
public partial class SettingsWindow : Window
{
    readonly BarViewModel vm; readonly IBarSettings settings; bool hydrating;

    internal SettingsWindow(BarViewModel vm, IBarSettings settings)
    {
        InitializeComponent();
        this.vm = vm; this.settings = settings;
        Hydrate();
        SourceInitialized += (_, _) => CenterOnCursorMonitor();
    }

    void Hydrate()
    {
        hydrating = true;
        var ui = settings.Ui; var alerts = settings.Alerts;
        foreach (var (segment, appearance) in new[] { (SystemSegment, BarAppearance.System), (LightSegment, BarAppearance.Light), (DarkSegment, BarAppearance.Dark) })
            segment.IsChecked = ui.Appearance == appearance;
        GlanceBox.SelectedIndex = (int)ui.GlanceMode;
        AutoUpdates.IsChecked = ui.AutoCheckUpdates;
        QuotaEnabled.IsChecked = alerts.QuotaEnabled;
        QuotaLevels.Text = string.Join(",", alerts.QuotaLevels);
        DailyEnabled.IsChecked = alerts.DailySpendEnabled; DailyCap.Text = CapText(alerts.DailyCapUsd);
        MonthEnabled.IsChecked = alerts.MonthSpendEnabled; MonthCap.Text = CapText(alerts.MonthCapUsd);
        ReauthEnabled.IsChecked = alerts.ReauthEnabled; PausedEnabled.IsChecked = alerts.CooldownPausedEnabled;
        RefreshEnabledStates();
        hydrating = false;
    }

    void RefreshEnabledStates()
    {
        LevelsRow.IsEnabled = QuotaEnabled.IsChecked == true;
        DailyCapRow.IsEnabled = DailyEnabled.IsChecked == true;
        MonthCapRow.IsEnabled = MonthEnabled.IsChecked == true;
    }

    void Save_Changed(object sender, RoutedEventArgs e) { RefreshEnabledStates(); Save(); }
    void Save_Changed(object sender, SelectionChangedEventArgs e) => Save();
    void Segment_Changed(object sender, RoutedEventArgs e) => Save();

    void QuotaLevels_LostFocus(object sender, RoutedEventArgs e) => CommitLevels();
    void Cap_LostFocus(object sender, RoutedEventArgs e) => Save();

    /// <summary>Enter inside a field commits it, mirroring SwiftUI .onSubmit.</summary>
    void Field_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        CommitLevels();
        e.Handled = true;
    }

    /// <summary>Parse the free-text levels into normalized ints and reflect the normalized form back.</summary>
    void CommitLevels()
    {
        if (hydrating) return;
        var levels = ParseLevels(QuotaLevels.Text);
        if (levels.Length > 0) QuotaLevels.Text = string.Join(",", levels);
        Save();
    }

    void Done_Click(object sender, RoutedEventArgs e) { CommitLevels(); Close(); }

    void Save()
    {
        if (hydrating || GlanceBox.SelectedIndex < 0) return;
        var appearance = LightSegment.IsChecked == true ? BarAppearance.Light : DarkSegment.IsChecked == true ? BarAppearance.Dark : BarAppearance.System;
        // Chart style / spend period stay untouched: those live in the panel's
        // Spend header where the chart is, exactly like macOS keeps them out of
        // the preferences sheet. IconStyle/AlertsExpanded are panel-scoped too.
        var ui = settings.Ui with { Appearance = appearance, GlanceMode = (BarGlanceMode)Math.Max(0, GlanceBox.SelectedIndex), AutoCheckUpdates = AutoUpdates.IsChecked == true };
        var old = settings.Alerts;
        var levels = ParseLevels(QuotaLevels.Text);
        var alerts = old with
        {
            QuotaEnabled = QuotaEnabled.IsChecked == true,
            QuotaLevelsValue = levels.Length > 0 ? levels : old.QuotaLevels,
            DailySpendEnabled = DailyEnabled.IsChecked == true,
            DailyCapUsd = TryCap(DailyCap.Text, old.DailyCapUsd),
            MonthSpendEnabled = MonthEnabled.IsChecked == true,
            MonthCapUsd = TryCap(MonthCap.Text, old.MonthCapUsd),
            ReauthEnabled = ReauthEnabled.IsChecked == true,
            CooldownPausedEnabled = PausedEnabled.IsChecked == true,
            GlanceMode = ui.GlanceMode,
        };
        vm.Ui = ui; vm.AlertPreferences = alerts;
        ((App)Application.Current).SettingsChanged();
    }

    static int[] ParseLevels(string text) => [.. text.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
        .Select(x => int.TryParse(x, out var n) ? Math.Clamp(n, 0, 100) : -1).Where(x => x >= 0).Distinct().OrderDescending()];
    static double TryCap(string text, double fallback) => double.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out var value) ? Math.Max(0, value) : fallback;
    static string CapText(double value) => value.ToString(CultureInfo.InvariantCulture);

    /// <summary>
    /// Centers on the screen that contains the mouse cursor at open time — the
    /// display where the user clicked Settings — instead of defaulting to the
    /// primary monitor. Mirrors SettingsWindowController.centerOnClickedScreen.
    /// </summary>
    void CenterOnCursorMonitor()
    {
        var screen = Forms.Screen.FromPoint(Forms.Cursor.Position);
        var fromDevice = PresentationSource.FromVisual(this)?.CompositionTarget?.TransformFromDevice ?? Matrix.Identity;
        var topLeft = fromDevice.Transform(new Point(screen.WorkingArea.Left, screen.WorkingArea.Top));
        var bottomRight = fromDevice.Transform(new Point(screen.WorkingArea.Right, screen.WorkingArea.Bottom));
        (Left, Top) = CenterWithin(new BarRect(topLeft.X, topLeft.Y, bottomRight.X - topLeft.X, bottomRight.Y - topLeft.Y), Width, Height);
    }

    public static (double Left, double Top) CenterWithin(BarRect work, double width, double height)
    {
        var x = Math.Clamp(work.X + (work.Width - width) / 2, work.X, Math.Max(work.X, work.Right - width));
        var y = Math.Clamp(work.Y + (work.Height - height) / 2, work.Y, Math.Max(work.Y, work.Bottom - height));
        return (x, y);
    }
}
