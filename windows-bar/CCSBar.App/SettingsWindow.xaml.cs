using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using CCSBar.Core;
using Application = System.Windows.Application;

namespace CCSBar.App;

public partial class SettingsWindow : Window
{
    readonly BarViewModel vm; readonly JsonBarSettings settings; bool hydrating;
    internal SettingsWindow(BarViewModel vm, JsonBarSettings settings) { InitializeComponent(); this.vm = vm; this.settings = settings; Loaded += (_, _) => Hydrate(); }
    void Hydrate()
    {
        hydrating = true; var ui = settings.Ui; var alerts = settings.Alerts;
        AppearanceBox.SelectedIndex = (int)ui.Appearance; IconBox.SelectedIndex = (int)ui.IconStyle; GlanceBox.SelectedIndex = (int)ui.GlanceMode; ChartBox.SelectedIndex = (int)ui.ChartStyle; PeriodBox.SelectedIndex = (int)ui.SpendPeriod;
        QuotaEnabled.IsChecked = alerts.QuotaEnabled; QuotaLevels.Text = string.Join(", ", alerts.QuotaLevels); DailyEnabled.IsChecked = alerts.DailySpendEnabled; DailyCap.Text = alerts.DailyCapUsd.ToString(CultureInfo.InvariantCulture); MonthEnabled.IsChecked = alerts.MonthSpendEnabled; MonthCap.Text = alerts.MonthCapUsd.ToString(CultureInfo.InvariantCulture); ReauthEnabled.IsChecked = alerts.ReauthEnabled; PausedEnabled.IsChecked = alerts.CooldownPausedEnabled; AlertsExpanded.IsChecked = ui.AlertsExpanded; AutoUpdates.IsChecked = ui.AutoCheckUpdates; hydrating = false;
    }
    void Save_Changed(object sender, RoutedEventArgs e) => Save(); void Save_Changed(object sender, SelectionChangedEventArgs e) => Save();
    void Save()
    {
        if (hydrating || AppearanceBox.SelectedIndex < 0) return;
        var ui = settings.Ui with { Appearance = (BarAppearance)AppearanceBox.SelectedIndex, IconStyle = (BarIconStyle)Math.Max(0, IconBox.SelectedIndex), GlanceMode = (BarGlanceMode)Math.Max(0, GlanceBox.SelectedIndex), ChartStyle = (SpendChartStyle)Math.Max(0, ChartBox.SelectedIndex), SpendPeriod = (SpendPeriod)Math.Max(0, PeriodBox.SelectedIndex), AlertsExpanded = AlertsExpanded.IsChecked == true, AutoCheckUpdates = AutoUpdates.IsChecked == true };
        var levels = QuotaLevels.Text.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Select(x => int.TryParse(x, out var n) ? Math.Clamp(n, 0, 100) : -1).Where(x => x >= 0).Distinct().OrderDescending().ToArray();
        var old = settings.Alerts; var alerts = old with { QuotaEnabled = QuotaEnabled.IsChecked == true, QuotaLevelsValue = levels.Length > 0 ? levels : old.QuotaLevels, DailySpendEnabled = DailyEnabled.IsChecked == true, DailyCapUsd = double.TryParse(DailyCap.Text, NumberStyles.Number, CultureInfo.InvariantCulture, out var daily) ? Math.Max(0, daily) : old.DailyCapUsd, MonthSpendEnabled = MonthEnabled.IsChecked == true, MonthCapUsd = double.TryParse(MonthCap.Text, NumberStyles.Number, CultureInfo.InvariantCulture, out var month) ? Math.Max(0, month) : old.MonthCapUsd, ReauthEnabled = ReauthEnabled.IsChecked == true, CooldownPausedEnabled = PausedEnabled.IsChecked == true, GlanceMode = ui.GlanceMode };
        vm.Ui = ui; vm.AlertPreferences = alerts; ((App)Application.Current).SettingsChanged();
    }
    void Close_Click(object sender, RoutedEventArgs e) => Close();
}
