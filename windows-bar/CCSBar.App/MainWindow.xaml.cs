using System.Windows;
using System.Windows.Automation;
using System.Windows.Automation.Peers;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using CCSBar.Core;
using Forms = System.Windows.Forms;
using Application = System.Windows.Application;
using Brush = System.Windows.Media.Brush;
using Button = System.Windows.Controls.Button;
using HorizontalAlignment = System.Windows.HorizontalAlignment;
using Orientation = System.Windows.Controls.Orientation;
using Pen = System.Windows.Media.Pen;

namespace CCSBar.App;

public partial class MainWindow : Window
{
    readonly BarViewModel vm; readonly JsonBarSettings settings; bool quitArmed; SettingsWindow? settingsWindow; bool firstShow = true;
    internal MainWindow(BarViewModel vm, JsonBarSettings settings)
    { InitializeComponent(); this.vm = vm; this.settings = settings; VersionText.Text = $"v{CCSBar.App.VersionText.Value}"; vm.PropertyChanged += ViewModelChanged; Loaded += (_, _) => Render(); }
    void ViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => Dispatcher.BeginInvoke(Render);
    public void Detach() => vm.PropertyChanged -= ViewModelChanged;
    public void ShowAnchored(System.Drawing.Point cursor)
    {
        quitArmed = false; QuitButton.Content = "Power"; Render(); UpdateLayout();
        var screen = Forms.Screen.FromPoint(cursor); var source = PresentationSource.FromVisual(this); var fromDevice = source?.CompositionTarget?.TransformFromDevice ?? Matrix.Identity; var topLeft = fromDevice.Transform(new System.Windows.Point(screen.WorkingArea.Left, screen.WorkingArea.Top)); var bottomRight = fromDevice.Transform(new System.Windows.Point(screen.WorkingArea.Right, screen.WorkingArea.Bottom)); var pointer = fromDevice.Transform(new System.Windows.Point(cursor.X, cursor.Y)); var work = new BarRect(topLeft.X, topLeft.Y, bottomRight.X - topLeft.X, bottomRight.Y - topLeft.Y); var tray = new BarRect(pointer.X, pointer.Y, 1, 1);
        var place = PanelPlacement.Anchor(work, tray, 360, Math.Min(ActualHeight > 0 ? ActualHeight : 700, work.Height));
        Left = place.X; Top = place.Y; firstShow = true; Show();
    }
    public void Render()
    {
        var focusName = Keyboard.FocusedElement is DependencyObject focused ? AutomationProperties.GetName(focused) : null;
        if (!IsInitialized) return; OfflinePanel.Visibility = vm.Offline || vm.IsStarting ? Visibility.Visible : Visibility.Collapsed; ContentScroll.Visibility = OfflinePanel.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible;
        OfflineTitle.Text = vm.IsStarting ? "Starting CCS..." : "CCS is not running"; OfflineBody.Text = vm.LastError ?? (vm.IsStarting ? "Waiting for CCS Bar server." : "Start CCS, then panel connects automatically."); StartButton.IsEnabled = RetryButton.IsEnabled = !vm.IsStarting; AutomationProperties.SetLiveSetting(StatusText, AutomationLiveSetting.Polite); StatusText.Text = vm.StatusTitle;
        UpdateButton.Visibility = vm.UpdateAvailable ? Visibility.Visible : Visibility.Collapsed; UpdateButton.Content = vm.IsInstallingUpdate ? "Updating..." : $"Update {vm.LatestVersion}";
        ContentPanel.Children.Clear(); if (vm.Offline || vm.IsStarting) return;
        if (vm.UpdateAvailable) ContentPanel.Children.Add(Banner("Update available", $"CCS Bar {vm.LatestVersion}", "AccentBrush")); if (vm.SummaryStale) ContentPanel.Children.Add(Banner("Accounts stale", "Showing last successful account refresh.", "AmberBrush"));
        AddAlerts(); var (subscriptions, pool) = BarRows.Partition(vm.Rows); AddSubscriptions(subscriptions); AddSpend(); AddPool(subscriptions, pool); AddBreakdown();
        if (!string.IsNullOrEmpty(focusName)) FindNamedControl(ContentPanel, focusName)?.Focus();
        if (vm.LastError is not null) ContentPanel.Children.Add(Banner("Last refresh failed", vm.LastError, "RedBrush"));
    }
    static System.Windows.Controls.Control? FindNamedControl(DependencyObject parent, string name)
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++) { var child = VisualTreeHelper.GetChild(parent, i); if (child is System.Windows.Controls.Control control && AutomationProperties.GetName(control) == name) return control; if (FindNamedControl(child, name) is { } nested) return nested; } return null;
    }
    void AddAlerts()
    {
        if (vm.ActiveAlerts.Count == 0) return; ContentPanel.Children.Add(Section("ALERTS")); var expanded = settings.Ui.AlertsExpanded; var shown = expanded ? vm.ActiveAlerts : vm.ActiveAlerts.Take(3);
        foreach (var alert in shown) ContentPanel.Children.Add(Banner(alert.Title, alert.Body, alert.Kind is BarAlertKind.ReauthNeeded ? "RedBrush" : "AmberBrush"));
        if (!expanded && vm.ActiveAlerts.Count > 3) { var more = new Button { Content = $"+{vm.ActiveAlerts.Count - 3} more", HorizontalAlignment = HorizontalAlignment.Left }; more.Click += (_, _) => { settings.Ui = settings.Ui with { AlertsExpanded = true }; settings.Save(); Render(); }; ContentPanel.Children.Add(more); }
    }
    void AddSubscriptions(IReadOnlyList<BarSummaryRow> subscriptions)
    {
        if (subscriptions.Count == 0) return; ContentPanel.Children.Add(Section("SUBSCRIPTIONS"));
        foreach (var provider in subscriptions.GroupBy(x => x.Provider))
        {
            var carousel = new ProfileCarousel(provider); var host = new StackPanel();
            void Paint() { host.Children.Clear(); if (carousel.Count > 1) { var nav = new DockPanel(); var prev = SmallButton("‹"); var next = SmallButton("›"); AutomationProperties.SetName(prev, $"Previous {BarRows.ProviderLabel(provider.Key)} profile"); AutomationProperties.SetName(next, $"Next {BarRows.ProviderLabel(provider.Key)} profile"); prev.Click += (_, _) => { carousel.Move(-1); Paint(); }; next.Click += (_, _) => { carousel.Move(1); Paint(); }; DockPanel.SetDock(prev, Dock.Left); DockPanel.SetDock(next, Dock.Right); nav.Children.Add(prev); nav.Children.Add(next); nav.Children.Add(new TextBlock { Text = $"{BarRows.ProviderLabel(provider.Key)} profiles", HorizontalAlignment = HorizontalAlignment.Center, Foreground = (Brush)FindResource("MutedBrush") }); host.Children.Add(nav); } host.Children.Add(SubscriptionCard(carousel.Selected)); }
            host.Focusable = true; host.KeyDown += (_, e) => { if (e.Key is Key.Left or Key.Right) { carousel.Move(e.Key == Key.Right ? 1 : -1); Paint(); e.Handled = true; } }; host.MouseWheel += (_, e) => { if (Keyboard.Modifiers.HasFlag(ModifierKeys.Shift)) { carousel.Move(e.Delta < 0 ? 1 : -1); Paint(); e.Handled = true; } }; Paint(); ContentPanel.Children.Add(host);
        }
    }
    Border SubscriptionCard(BarSummaryRow row)
    {
        var stack = new StackPanel(); stack.Children.Add(TitleRow(row, true)); var windows = row.QuotaWindows ?? [];
        if (windows.Count == 0) stack.Children.Add(Muted(row.NeedsReauth ? "reauth needed" : BarFormatting.QuotaLabel(row.QuotaPercentage, row.QuotaStatus)));
        foreach (var window in windows) { var grid = new Grid(); grid.ColumnDefinitions.Add(new() { Width = new(72) }); grid.ColumnDefinitions.Add(new()); grid.ColumnDefinitions.Add(new() { Width = new(45) }); grid.ColumnDefinitions.Add(new() { Width = new(80) }); grid.Children.Add(new TextBlock { Text = window.Label, FontSize = 11, VerticalAlignment = VerticalAlignment.Center }); var gauge = Gauge(window.RemainingPercent, "ok"); Grid.SetColumn(gauge, 1); grid.Children.Add(gauge); var value = new TextBlock { Text = $"{window.RemainingPercent:0}%", FontFamily = new("Consolas"), FontSize = 11, HorizontalAlignment = HorizontalAlignment.Right }; Grid.SetColumn(value, 2); grid.Children.Add(value); var reset = new TextBlock { Text = BarQuota.ResetCountdown(window.ResetAt, DateTimeOffset.Now)?.Replace("resets in ", "") ?? "", FontSize = 10, Foreground = (Brush)FindResource("MutedBrush"), HorizontalAlignment = HorizontalAlignment.Right }; Grid.SetColumn(reset, 3); grid.Children.Add(reset); stack.Children.Add(grid); var binding = BarQuota.SelectBindingWindow(windows); if (binding == window) { var pace = BarQuota.PaceClause(window.UsedPercent, window.RemainingPercent, window.ResetAt, window.WindowMinutes, DateTimeOffset.Now); if (pace is not null) stack.Children.Add(Muted(pace)); } }
        if (row.StaleAsOf is not null || row.Cached) stack.Children.Add(Muted("cached data · refresh for latest")); return Card(stack, row.Paused ? .5 : 1);
    }
    void AddSpend()
    {
        if (vm.Analytics is not { } a) return; ContentPanel.Children.Add(Section("SPEND")); if (vm.AnalyticsStale) ContentPanel.Children.Add(Muted("Spend data stale · showing last successful refresh")); var stack = new StackPanel(); var period = settings.Ui.SpendPeriod; var current = period switch { SpendPeriod.Today => a.Today, SpendPeriod.Last30d => a.Last30d, _ => a.Last7d };
        var top = new DockPanel(); top.Children.Add(new TextBlock { Text = $"today {BarFormatting.Money(a.Today.Cost)} · 7d {BarFormatting.Money(a.Last7d.Cost)}", Foreground = (Brush)FindResource("MutedBrush") }); var toggle = SmallButton(settings.Ui.ChartStyle == SpendChartStyle.Bars ? "Line" : "Bars"); DockPanel.SetDock(toggle, Dock.Right); toggle.Click += (_, _) => { settings.Ui = settings.Ui with { ChartStyle = settings.Ui.ChartStyle == SpendChartStyle.Bars ? SpendChartStyle.Line : SpendChartStyle.Bars }; settings.Save(); Render(); }; top.Children.Add(toggle); stack.Children.Add(top);
        var periods = new StackPanel { Orientation = Orientation.Horizontal }; foreach (var item in Enum.GetValues<SpendPeriod>()) { var button = SmallButton(item switch { SpendPeriod.Today => "Today", SpendPeriod.Last7d => "7d", _ => "30d" }); button.IsEnabled = item != period; button.Click += (_, _) => { settings.Ui = settings.Ui with { SpendPeriod = item }; settings.Save(); Render(); }; periods.Children.Add(button); } stack.Children.Add(periods);
        var values = period == SpendPeriod.Today ? a.ByHour.Select(x => x.Cost) : a.ByDay.TakeLast(period == SpendPeriod.Last7d ? 7 : 30).Select(x => x.Cost); stack.Children.Add(new SpendChart { Values = values.ToArray(), ChartStyle = settings.Ui.ChartStyle, Height = 42, Margin = new(0, 4, 0, 2) }); stack.Children.Add(Muted($"{BarFormatting.Money(current.Cost)} · {BarFormatting.Count(current.Requests)} requests")); ContentPanel.Children.Add(Card(stack));
    }
    void AddPool(IReadOnlyList<BarSummaryRow> subscriptions, IReadOnlyList<BarSummaryRow> pool)
    {
        if (subscriptions.Count == 0 || pool.Count == 0) return; ContentPanel.Children.Add(Section("POOL ACCOUNTS"));
        foreach (var row in pool) { var stack = new StackPanel { Opacity = row.Paused ? .5 : 1 }; stack.Children.Add(TitleRow(row, false)); var line = new DockPanel(); line.Children.Add(Gauge(row.QuotaPercentage, row.QuotaStatus)); var actions = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right }; var pause = SmallButton(row.Paused ? "Resume" : "Pause"); AutomationProperties.SetName(pause, $"{(row.Paused ? "Resume" : "Pause")} {BarRows.AccountTitle(row)}"); pause.Click += async (_, _) => { if (row.Paused) await vm.ResumeAsync(row); else await vm.PauseAsync(row); }; actions.Children.Add(pause); var menu = SmallButton("..."); AutomationProperties.SetName(menu, $"Actions for {BarRows.AccountTitle(row)}"); menu.ContextMenu = ActionsMenu(row); menu.Click += (_, _) => { menu.ContextMenu.PlacementTarget = menu; menu.ContextMenu.IsOpen = true; }; actions.Children.Add(menu); DockPanel.SetDock(actions, Dock.Right); line.Children.Add(actions); stack.Children.Add(line); var detail = new[] { BarFormatting.QuotaLabel(row.QuotaPercentage, row.QuotaStatus), BarQuota.ResetCountdown(row.NextReset, DateTimeOffset.Now), row.Provider, row.Tier, BarFormatting.LastActiveLabel(row.LastActivityAt, null, DateTimeOffset.Now), row.TodayCost is null ? "no data" : $"today {BarFormatting.Money(row.TodayCost.Value)}" }.Where(x => !string.IsNullOrWhiteSpace(x)); stack.Children.Add(Muted(string.Join(" · ", detail))); ContentPanel.Children.Add(Card(stack)); }
    }
    ContextMenu ActionsMenu(BarSummaryRow row)
    {
        var menu = new ContextMenu(); void Add(string text, Func<Task> action) { var item = new MenuItem { Header = text }; item.Click += async (_, _) => await action(); menu.Items.Add(item); }
        if (!row.IsDefault) Add("Set default", () => vm.SetDefaultAsync(row)); Add("Solo", () => vm.SoloAsync(row)); menu.Items.Add(new Separator()); foreach (var tier in new string?[] { null, "free", "pro", "max" }) Add(tier is null ? "Clear tier lock" : $"Lock tier: {tier}", () => vm.TierLockAsync(row, tier)); return menu;
    }
    void AddBreakdown()
    {
        if (vm.Analytics is not { } a) return; if (a.BySurface.Count > 0) { ContentPanel.Children.Add(Section("BY SURFACE")); foreach (var item in a.BySurface.Take(5)) ContentPanel.Children.Add(BarRow(item.Surface, item.Cost, a.BySurface.Max(x => x.Cost), "SubscriptionBrush")); } if (a.TopModels.Count > 0) { ContentPanel.Children.Add(Section($"TOP MODELS · {(a.TopModelsWindow == "30d" ? "30D" : "ALL-TIME")}")); foreach (var item in a.TopModels.Take(4)) ContentPanel.Children.Add(BarRow(item.Model, item.Cost, a.TopModels.Max(x => x.Cost), "AccentBrush")); }
    }
    UIElement BarRow(string label, double cost, double peak, string brush) { var grid = new Grid { Height = 27, Margin = new(0, 2, 0, 2), Background = (Brush)FindResource("CardBrush") }; var fill = new Border { Background = (Brush)FindResource(brush), Opacity = .18, HorizontalAlignment = HorizontalAlignment.Left, Width = Math.Max(8, 310 * (peak > 0 ? cost / peak : 0)), CornerRadius = new(5) }; grid.Children.Add(fill); var dock = new DockPanel { Margin = new(9, 4, 9, 3) }; var money = new TextBlock { Text = BarFormatting.Money(cost), FontFamily = new("Consolas"), Foreground = (Brush)FindResource("MutedBrush") }; DockPanel.SetDock(money, Dock.Right); dock.Children.Add(money); dock.Children.Add(new TextBlock { Text = label, TextTrimming = TextTrimming.CharacterEllipsis }); grid.Children.Add(dock); return grid; }
    DockPanel TitleRow(BarSummaryRow row, bool subscription) { var dock = new DockPanel(); var dot = new Ellipse { Width = 8, Height = 8, Fill = (Brush)FindResource(row.Health == "error" ? "RedBrush" : row.Health == "warning" ? "AmberBrush" : "GreenBrush"), Margin = new(0, 5, 8, 0), VerticalAlignment = VerticalAlignment.Top }; AutomationProperties.SetName(dot, $"{row.Health} status"); DockPanel.SetDock(dot, Dock.Left); dock.Children.Add(dot); var name = new TextBlock { Text = row.DisplayName ?? BarRows.AccountTitle(row), FontWeight = FontWeights.Medium, TextTrimming = TextTrimming.CharacterEllipsis }; dock.Children.Add(name); var chips = new TextBlock { Text = string.Join("  ", new[] { subscription ? BarRows.AccountTag(row) : null, row.IsDefault ? "default" : null, row.Paused ? "paused" : null, row.NeedsReauth ? "reauth" : null, row.Tier }.Where(x => x is not null).Distinct()), FontSize = 10, Foreground = (Brush)FindResource(subscription ? "SubscriptionBrush" : "AccentBrush"), HorizontalAlignment = HorizontalAlignment.Right }; DockPanel.SetDock(chips, Dock.Right); dock.Children.Add(chips); return dock; }
    System.Windows.Controls.ProgressBar Gauge(double? percentage, string status) { var value = BarQuota.FillFraction(percentage, status); var gauge = new System.Windows.Controls.ProgressBar { Height = 7, Minimum = 0, Maximum = 100, Value = value is null ? 0 : value.Value * 100, Foreground = (Brush)FindResource(BarQuota.Band(percentage, status) switch { QuotaBand.Green => "GreenBrush", QuotaBand.Yellow => "AmberBrush", QuotaBand.Orange => "CoralBrush", QuotaBand.Red => "RedBrush", _ => "MutedBrush" }), Background = (Brush)FindResource("TrackBrush"), Margin = new(0, 5, 8, 4) }; AutomationProperties.SetName(gauge, "Quota remaining"); AutomationProperties.SetHelpText(gauge, BarFormatting.QuotaLabel(percentage, status)); return gauge; }
    Border Card(UIElement child, double opacity = 1) => new() { Child = child, Background = (Brush)FindResource("CardBrush"), CornerRadius = new(9), Padding = new(10, 8, 10, 8), Margin = new(0, 0, 0, 7), Opacity = opacity };
    TextBlock Section(string text) => new() { Text = text, FontSize = 11, FontWeight = FontWeights.Bold, Foreground = (Brush)FindResource("MutedBrush"), Margin = new(0, 5, 0, 4) };
    TextBlock Muted(string text) => new() { Text = text, FontSize = 11, Foreground = (Brush)FindResource("MutedBrush"), TextWrapping = TextWrapping.Wrap, Margin = new(0, 3, 0, 2) };
    Border Banner(string title, string body, string brush) { var stack = new StackPanel(); stack.Children.Add(new TextBlock { Text = title, FontWeight = FontWeights.SemiBold, Foreground = (Brush)FindResource(brush) }); stack.Children.Add(Muted(body)); return Card(stack); }
    System.Windows.Controls.Button SmallButton(string text) => new() { Content = text, Padding = new(6, 2, 6, 2), Margin = new(2), FontSize = 11 };
    async void Refresh_Click(object sender, RoutedEventArgs e) => await vm.ForceRefreshAsync(); async void Retry_Click(object sender, RoutedEventArgs e) => await vm.RetryAsync(); async void Start_Click(object sender, RoutedEventArgs e) => await vm.StartAsync();
    void Chart_Click(object sender, RoutedEventArgs e) { settings.Ui = settings.Ui with { ChartStyle = settings.Ui.ChartStyle == SpendChartStyle.Bars ? SpendChartStyle.Line : SpendChartStyle.Bars }; settings.Save(); Render(); }
    void Dashboard_Click(object sender, RoutedEventArgs e) { if (vm.ActiveBaseUrl is not null) try { new DashboardLauncher(WindowsProcess.Start).Open(vm.ActiveBaseUrl); } catch (Exception ex) { System.Windows.MessageBox.Show(ex.Message, "CCS Bar", MessageBoxButton.OK, MessageBoxImage.Error); } Hide(); }
    void Settings_Click(object sender, RoutedEventArgs e) { settingsWindow ??= new SettingsWindow(vm, settings) { Owner = null }; settingsWindow.Closed += (_, _) => settingsWindow = null; settingsWindow.Show(); settingsWindow.Activate(); }
    void Update_Click(object sender, RoutedEventArgs e) { if (vm.IsInstallingUpdate) return; vm.IsInstallingUpdate = true; try { new WindowsBarUpdater(WindowsProcess.Start).Install(); ((App)Application.Current).Exit(); } catch (Exception ex) { vm.IsInstallingUpdate = false; System.Windows.MessageBox.Show(ex.Message, "CCS Bar update failed", MessageBoxButton.OK, MessageBoxImage.Error); } }
    void Quit_Click(object sender, RoutedEventArgs e) { if (!quitArmed) { quitArmed = true; QuitButton.Content = "Confirm quit"; QuitButton.Foreground = (Brush)FindResource("RedBrush"); return; } ((App)Application.Current).Exit(); }
    void Window_Deactivated(object sender, EventArgs e) { if (firstShow) { firstShow = false; return; } if (settingsWindow?.IsActive != true) Hide(); } void Window_KeyDown(object sender, System.Windows.Input.KeyEventArgs e) { if (e.Key == Key.Escape) Hide(); }
}

sealed class SpendChart : FrameworkElement
{
    public double[] Values { get; set; } = []; public SpendChartStyle ChartStyle { get; set; }
    protected override void OnRender(DrawingContext dc) { base.OnRender(dc); if (Values.Length == 0) return; var peak = Values.Max(); if (peak <= 0) return; var brush = (Brush)FindResource("AccentBrush"); var step = ActualWidth / Values.Length; if (ChartStyle == SpendChartStyle.Bars) { for (var i = 0; i < Values.Length; i++) { var h = (ActualHeight - 2) * Values[i] / peak; dc.DrawRoundedRectangle(brush, null, new System.Windows.Rect(i * step + 1, ActualHeight - h, Math.Max(2, step - 2), h), 2, 2); } } else { var geometry = new StreamGeometry(); using (var c = geometry.Open()) { c.BeginFigure(new(0, ActualHeight - Values[0] / peak * ActualHeight), false, false); for (var i = 1; i < Values.Length; i++) c.LineTo(new(i * step, ActualHeight - Values[i] / peak * ActualHeight), true, false); } dc.DrawGeometry(null, new Pen(brush, 2), geometry); } }
}
