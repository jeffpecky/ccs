using System.Windows;
using System.Windows.Automation;
using System.Windows.Automation.Peers;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Shapes;
using CCSBar.Core;
using Forms = System.Windows.Forms;
using Application = System.Windows.Application;
using Brush = System.Windows.Media.Brush;
using Brushes = System.Windows.Media.Brushes;
using Button = System.Windows.Controls.Button;
using Control = System.Windows.Controls.Control;
using FlowDirection = System.Windows.FlowDirection;
using ProgressBar = System.Windows.Controls.ProgressBar;
using Color = System.Windows.Media.Color;
using FontFamily = System.Windows.Media.FontFamily;
using HorizontalAlignment = System.Windows.HorizontalAlignment;
using Orientation = System.Windows.Controls.Orientation;
using Pen = System.Windows.Media.Pen;

namespace CCSBar.App;

public partial class MainWindow : Window
{
    const int WMMouseHWheel = 0x020E;
    readonly BarViewModel vm; readonly IBarSettings settings; readonly IBarClock clock; readonly PanelActivationGuard activationGuard = new(); bool quitArmed; SettingsWindow? settingsWindow; string? updateError;
    readonly Action installUpdate;
    readonly List<(StackPanel Host, ProfileCarousel Carousel, Action Paint)> carousels = [];
    internal MainWindow(BarViewModel vm, IBarSettings settings, IBarClock? clock = null, Action? installUpdate = null)
    {
        InitializeComponent(); this.vm = vm; this.settings = settings; this.clock = clock ?? new SystemBarClock();
        this.installUpdate = installUpdate ?? DefaultInstallUpdate;
        VersionText.Text = $"v{CCSBar.App.VersionText.Value}"; vm.PropertyChanged += ViewModelChanged; Loaded += (_, _) => Render();
    }
    static void DefaultInstallUpdate() => new WindowsBarUpdater(WindowsProcess.Start).Install();
    DateTimeOffset Now => clock.Now;
    void ViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => Dispatcher.BeginInvoke(Render);
    public void Detach() => vm.PropertyChanged -= ViewModelChanged;
    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        if (PresentationSource.FromVisual(this) is HwndSource source) source.AddHook(WndProc);
    }
    IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg != WMMouseHWheel) return IntPtr.Zero;
        var carousel = carousels.FirstOrDefault(c => c.Host.IsMouseOver);
        if (carousel.Host is null) return IntPtr.Zero;
        carousel.Carousel.Move(wParam.ToInt32() > 0 ? 1 : -1);
        carousel.Paint();
        handled = true;
        return IntPtr.Zero;
    }
    public void ShowAnchored(System.Drawing.Point cursor)
    {
        quitArmed = false; QuitGlyph.Text = "\uE7E8"; QuitButton.ClearValue(ForegroundProperty); QuitButton.ToolTip = "Quit CCS Bar (click again to confirm)"; Render(); UpdateLayout();
        var screen = Forms.Screen.FromPoint(cursor); var source = PresentationSource.FromVisual(this); var fromDevice = source?.CompositionTarget?.TransformFromDevice ?? Matrix.Identity; var topLeft = fromDevice.Transform(new System.Windows.Point(screen.WorkingArea.Left, screen.WorkingArea.Top)); var bottomRight = fromDevice.Transform(new System.Windows.Point(screen.WorkingArea.Right, screen.WorkingArea.Bottom)); var pointer = fromDevice.Transform(new System.Windows.Point(cursor.X, cursor.Y)); var work = new BarRect(topLeft.X, topLeft.Y, bottomRight.X - topLeft.X, bottomRight.Y - topLeft.Y); var tray = new BarRect(pointer.X, pointer.Y, 1, 1);
        ContentScroll.MaxHeight = Math.Max(240, work.Height - 120); UpdateLayout();
        var place = PanelPlacement.Anchor(work, tray, 360, Math.Min(ActualHeight > 0 ? ActualHeight : 700, work.Height));
        Left = place.X; Top = place.Y; activationGuard.Activated(Now); Show();
    }
    public void Render()
    {
        var focusName = Keyboard.FocusedElement is DependencyObject focused ? AutomationProperties.GetName(focused) : null;
        if (!IsInitialized) return; OfflinePanel.Visibility = vm.Offline || vm.IsStarting ? Visibility.Visible : Visibility.Collapsed; ContentScroll.Visibility = OfflinePanel.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible;
        OfflineTitle.Text = vm.IsStarting ? "Starting CCS…" : "CCS is not running"; OfflineBody.Text = "Start CCS, then the menu will connect automatically."; OfflineBody.Visibility = OfflineActions.Visibility = vm.IsStarting ? Visibility.Collapsed : Visibility.Visible; StartingProgress.Visibility = vm.IsStarting ? Visibility.Visible : Visibility.Collapsed; StartButton.IsEnabled = RetryButton.IsEnabled = !vm.IsStarting; HeaderRefresh.Visibility = vm.IsRefreshing ? Visibility.Visible : Visibility.Collapsed; AutomationProperties.SetLiveSetting(StatusText, AutomationLiveSetting.Polite); StatusText.Text = vm.StatusTitle;
        ContentPanel.Children.Clear(); carousels.Clear(); EmptyState.Visibility = Visibility.Collapsed; if (vm.Offline || vm.IsStarting) return;
        updateError = vm.UpdateAvailable ? updateError : null;
        if (vm.UpdateAvailable) ContentPanel.Children.Add(UpdateBanner()); if (vm.SummaryStale) ContentPanel.Children.Add(Banner("Accounts stale", "Showing last successful account refresh.", "AmberBrush"));
        AddAlerts(); var (subscriptions, pool) = BarRows.Partition(vm.Rows); AddSubscriptions(subscriptions); AddSpend(); AddPool(subscriptions, pool); AddBreakdown(); EmptyState.Visibility = ContentPanel.Children.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        if (!string.IsNullOrEmpty(focusName)) FindNamedControl(ContentPanel, focusName)?.Focus();
        if (vm.LastError is not null) ContentPanel.Children.Add(Banner("Last refresh failed", vm.LastError, "RedBrush"));
    }
    static System.Windows.Controls.Control? FindNamedControl(DependencyObject parent, string name)
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++) { var child = VisualTreeHelper.GetChild(parent, i); if (child is System.Windows.Controls.Control control && AutomationProperties.GetName(control) == name) return control; if (FindNamedControl(child, name) is { } nested) return nested; } return null;
    }
    void AddAlerts()
    {
        if (vm.ActiveAlerts.Count == 0) return;
        var groups = AlertDisplay.Group(vm.ActiveAlerts);
        var header = new StackPanel { Orientation = Orientation.Horizontal };
        header.Children.Add(Section("ALERTS"));
        var badge = new Border { CornerRadius = new(100), Padding = new(5, 1, 5, 1), VerticalAlignment = VerticalAlignment.Center, Margin = new(6, 0, 0, 0), Tag = "alert-count-badge", Background = Tinted("MutedBrush", 0.18) };
        var badgeText = new TextBlock { Text = groups.Count.ToString(), FontSize = 10, FontWeight = FontWeights.SemiBold };
        badgeText.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
        badge.Child = badgeText;
        header.Children.Add(badge);
        ContentPanel.Children.Add(header);
        var expanded = settings.Ui.AlertsExpanded;
        var overflow = groups.Count - 3;
        foreach (var group in groups.Take(expanded ? groups.Count : 3)) ContentPanel.Children.Add(AlertRow(group));
        if (overflow > 0)
        {
            var more = new Button { Background = Brushes.Transparent, Padding = new(2, 1, 2, 1), Margin = new(0, 2, 0, 0), HorizontalAlignment = HorizontalAlignment.Left, HorizontalContentAlignment = HorizontalAlignment.Left };
            more.SetResourceReference(Control.ForegroundProperty, "MutedBrush");
            var row = new StackPanel { Orientation = Orientation.Horizontal };
            var chevron = new TextBlock { Text = expanded ? "\uE70E" : "\uE70D", FontSize = 9, FontWeight = FontWeights.Bold, VerticalAlignment = VerticalAlignment.Center };
            chevron.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
            row.Children.Add(chevron);
            var label = new TextBlock { Text = expanded ? "Show less" : $"{overflow} more", FontSize = 11, Margin = new(4, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
            label.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
            row.Children.Add(label);
            more.Content = row;
            AutomationProperties.SetName(more, expanded ? "Show fewer alerts" : "Show all alerts");
            more.Click += (_, _) => { settings.Ui = settings.Ui with { AlertsExpanded = !settings.Ui.AlertsExpanded }; settings.Save(); Render(); };
            ContentPanel.Children.Add(more);
        }
    }
    FrameworkElement AlertRow(AlertGroup group)
    {
        var alert = group.Alert;
        var (glyph, mono, tintKey) = alert.Kind switch
        {
            BarAlertKind.ReauthNeeded => ("\uE72E", true, "RedBrush"),
            BarAlertKind.DailySpendAbove or BarAlertKind.MonthSpendAbove => ("$", false, "AccentBrush"),
            BarAlertKind.QuotaRemainingBelow => ("\uE7BA", true, "AccentBrush"),
            _ => ("\uE769", true, "MutedBrush"),
        };
        var row = new Border { CornerRadius = new(6), Padding = new(8, 4, 8, 4), Margin = new(0, 1, 0, 1), Tag = "alert-row", Background = Tinted(tintKey, 0.08) };
        AutomationProperties.SetName(row, $"{alert.Title}: {alert.Body}");
        var line = new StackPanel { Orientation = Orientation.Horizontal };
        var icon = new TextBlock { Text = glyph, FontSize = 11, Width = 12, Tag = "alert-icon", VerticalAlignment = VerticalAlignment.Center };
        if (mono) icon.FontFamily = new FontFamily("Segoe MDL2 Assets");
        icon.SetResourceReference(TextBlock.ForegroundProperty, tintKey);
        line.Children.Add(icon);
        var body = new TextBlock { Text = alert.Body, FontSize = 11, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center, Margin = new(6, 0, 0, 0) };
        body.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
        line.Children.Add(body);
        if (group.Count > 1)
        {
            var count = new TextBlock { Text = $"×{group.Count}", FontSize = 9, FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center, Margin = new(6, 0, 0, 0) };
            count.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
            line.Children.Add(count);
        }
        row.Child = line;
        return row;
    }
    void AddSubscriptions(IReadOnlyList<BarSummaryRow> subscriptions)
    {
        if (subscriptions.Count == 0) return;
        var ordered = BarRows.OrderSubscriptions(subscriptions);
        ContentPanel.Children.Add(SectionHeader("Subscriptions", MostRoomLabel(ordered)));
        var groups = ordered.GroupBy(x => x.Provider).OrderBy(x => x.Key, StringComparer.Ordinal).ToList();
        foreach (var group in groups) ContentPanel.Children.Add(ProviderGroup(group.ToList(), groups.Count > 1));
    }
    string? MostRoomLabel(IReadOnlyList<BarSummaryRow> subscriptions) => BarQuota.HeadroomLeader(subscriptions) is { } leader
        ? $"most room: {BarRows.ProviderLabel(leader.Label)} {Math.Round(leader.RemainingPercent, MidpointRounding.AwayFromZero):0}%"
        : null;
    StackPanel ProviderGroup(IReadOnlyList<BarSummaryRow> rows, bool multiProvider)
    {
        var group = new StackPanel();
        var label = BarRows.ProviderLabel(rows[0].Provider);
        if (multiProvider) group.Children.Add(ProviderCaption(label));
        var carousel = new ProfileCarousel(rows);
        var host = new StackPanel();
        void Paint()
        {
            host.Children.Clear();
            host.Children.Add(SubscriptionCard(carousel.Selected));
            if (carousel.Count > 1) host.Children.Add(CarouselControls(carousel, Paint));
        }
        host.Focusable = true;
        host.KeyDown += (_, e) => { if (e.Key is Key.Left or Key.Right) { carousel.Move(e.Key == Key.Right ? 1 : -1); Paint(); e.Handled = true; } };
        host.MouseWheel += (_, e) => { if (Keyboard.Modifiers.HasFlag(ModifierKeys.Shift)) { carousel.Move(e.Delta < 0 ? 1 : -1); Paint(); e.Handled = true; } };
        Paint();
        carousels.Add((host, carousel, Paint));
        group.Children.Add(host);
        return group;
    }
    FrameworkElement CarouselControls(ProfileCarousel carousel, Action repaint)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center, Margin = new(0, 5, 0, 0) };
        var prev = ArrowButton("‹", $"Previous {BarRows.ProviderLabel(carousel.Selected.Provider)} profile", carousel.Index > 0);
        prev.Click += (_, _) => { carousel.Move(-1); repaint(); };
        row.Children.Add(prev);
        for (var page = 0; page < carousel.Pages.Count; page++)
        {
            var index = page;
            var selected = index == carousel.Index;
            var dotVisual = new Ellipse { Width = 6, Height = 6 };
            if (selected) dotVisual.SetResourceReference(Shape.FillProperty, "SubscriptionBrush");
            else dotVisual.Fill = Tinted("MutedBrush", 0.3);
            var dot = new Button { Content = dotVisual, Padding = new(4), Margin = new Thickness(1, 0, 1, 0), Background = Brushes.Transparent };
            AutomationProperties.SetName(dot, $"Show {BarRows.AccountTitle(carousel.Pages[index])} profile");
            dot.Click += (_, _) => { carousel.Move(index - carousel.Index); repaint(); };
            row.Children.Add(dot);
        }
        var next = ArrowButton("›", $"Next {BarRows.ProviderLabel(carousel.Selected.Provider)} profile", carousel.Index < carousel.Count - 1);
        next.Click += (_, _) => { carousel.Move(1); repaint(); };
        row.Children.Add(next);
        return row;
    }
    Button ArrowButton(string glyph, string name, bool enabled)
    {
        var button = new Button
        {
            Content = glyph, FontSize = 9, FontWeight = FontWeights.Bold, Padding = new(0),
            Width = 16, Height = 16, Background = Brushes.Transparent, IsEnabled = enabled, Opacity = enabled ? 0.7 : 0.25,
        };
        AutomationProperties.SetName(button, name);
        return button;
    }
    Border SubscriptionCard(BarSummaryRow row)
    {
        var stack = new StackPanel();
        stack.Children.Add(SubscriptionTitle(row));
        var windows = BarQuota.OrderedWindows(row.QuotaWindows ?? []);
        if (windows.Count == 0) stack.Children.Add(Muted(row.NeedsReauth ? "reauth needed" : BarFormatting.QuotaLabel(row.QuotaPercentage, row.QuotaStatus)));
        else
        {
            var binding = BarQuota.SelectBindingWindow(windows);
            foreach (var window in windows) stack.Children.Add(QuotaBarRow(window, ReferenceEquals(window, binding)));
            if (StaleFootnote(row) is { } footnote) stack.Children.Add(footnote);
        }
        var card = Card(stack, row.Paused ? 0.5 : 1);
        card.Tag = "subscription-card";
        return card;
    }
    DockPanel SubscriptionTitle(BarSummaryRow row)
    {
        var dock = new DockPanel();
        var dot = HealthDot(row);
        DockPanel.SetDock(dot, Dock.Left);
        dock.Children.Add(dot);
        var chips = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        if (BarRows.AccountTag(row) is { } tag) chips.Children.Add(Chip(tag, "SubscriptionBrush"));
        if (BarRows.IsNativeSubscription(row)) chips.Children.Add(Chip("subscription", "SubscriptionBrush"));
        if (row.NeedsReauth) chips.Children.Add(Chip("reauth", "RedBrush"));
        if (row.Tier is { } tier) chips.Children.Add(Chip(tier, "SubscriptionBrush"));
        DockPanel.SetDock(chips, Dock.Right);
        dock.Children.Add(chips);
        dock.Children.Add(new TextBlock { Text = BarRows.AccountTitle(row), FontWeight = FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center, Margin = new(0, 0, 4, 0) });
        return dock;
    }
    FrameworkElement QuotaBarRow(QuotaWindowDetail window, bool isBinding)
    {
        var grid = new Grid { Tag = window.Key, Margin = new(0, 2, 0, 2) };
        foreach (var width in new double[] { 32, 110, 5, 32, 5, 48 }) grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(width) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var label = new TextBlock { Text = ShortWindowLabel(window), FontFamily = (FontFamily)FindResource("FontFamily.Mono"), FontSize = 11, FontWeight = isBinding ? FontWeights.SemiBold : FontWeights.Normal, VerticalAlignment = VerticalAlignment.Center };
        label.SetResourceReference(TextBlock.ForegroundProperty, isBinding ? "TextBrush" : "MutedBrush");
        grid.Children.Add(label);
        var height = isBinding ? 7d : 5d;
        var track = new Border { Height = height, CornerRadius = new(height / 2), Tag = "quota-track", Opacity = isBinding ? 0.14 : 0.09 };
        track.SetResourceReference(Border.BackgroundProperty, "TextBrush");
        var band = BarQuota.Band(window.RemainingPercent, "ok");
        var bandKey = BandKey(band);
        var fill = new Border { Height = height, CornerRadius = new(height / 2), Width = Math.Max(2, 110 * (BarQuota.FillFraction(window.RemainingPercent, "ok") ?? 0)), HorizontalAlignment = HorizontalAlignment.Left, Tag = "quota-fill" };
        fill.SetResourceReference(Border.BackgroundProperty, bandKey);
        var bar = new Grid { VerticalAlignment = VerticalAlignment.Center };
        bar.Children.Add(track); bar.Children.Add(fill);
        AutomationProperties.SetName(bar, "Quota remaining");
        AutomationProperties.SetHelpText(bar, $"{ShortWindowLabel(window)}: {Math.Round(window.RemainingPercent, MidpointRounding.AwayFromZero):0}% remaining");
        Grid.SetColumn(bar, 1);
        grid.Children.Add(bar);
        var percent = new TextBlock { Text = $"{Math.Round(window.RemainingPercent, MidpointRounding.AwayFromZero):0}%", FontFamily = (FontFamily)FindResource("FontFamily.Mono"), FontSize = 11, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
        percent.SetResourceReference(TextBlock.ForegroundProperty, isBinding ? bandKey : "MutedBrush");
        Grid.SetColumn(percent, 3);
        grid.Children.Add(percent);
        var reset = new TextBlock { Text = BarCardFormatting.ShortReset(window.ResetAt, Now) ?? "", FontFamily = (FontFamily)FindResource("FontFamily.Mono"), FontSize = 11, Opacity = isBinding ? 1 : 0.6, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
        reset.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
        Grid.SetColumn(reset, 5);
        grid.Children.Add(reset);
        if (isBinding && BarQuota.PaceWarning(window.UsedPercent, window.RemainingPercent, window.ResetAt, window.WindowMinutes, Now) is { } warning)
        {
            var pace = new TextBlock { Text = warning, FontFamily = (FontFamily)FindResource("FontFamily.Mono"), FontSize = 11, Margin = new(5, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
            pace.SetResourceReference(TextBlock.ForegroundProperty, "CoralBrush");
            Grid.SetColumn(pace, 6);
            grid.Children.Add(pace);
        }
        return grid;
    }
    FrameworkElement? StaleFootnote(BarSummaryRow row)
    {
        if (row.StaleAsOf is not { } stale || BarCardFormatting.ClockTime(stale) is not { } clockTime) return null;
        var line = new StackPanel { Orientation = Orientation.Horizontal, Margin = new(0, 4, 0, 0) };
        var icon = new TextBlock { Text = "\uE823", FontFamily = new("Segoe MDL2 Assets"), FontSize = 9, Opacity = 0.6, VerticalAlignment = VerticalAlignment.Center };
        icon.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
        line.Children.Add(icon);
        var caption = new TextBlock { Text = $"as of {clockTime}, older session", FontSize = 11, Margin = new(4, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center, Opacity = 0.6 };
        caption.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
        line.Children.Add(caption);
        var refresh = new Button { Content = "\uE72C", FontFamily = new("Segoe MDL2 Assets"), FontSize = 9, Padding = new(2, 0, 2, 0), Background = Brushes.Transparent, Opacity = 0.6, VerticalAlignment = VerticalAlignment.Center };
        refresh.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
        refresh.ToolTip = "Force refresh to get the latest data";
        AutomationProperties.SetName(refresh, "Force refresh");
        refresh.Click += async (_, _) => await vm.ForceRefreshAsync();
        line.Children.Add(refresh);
        return line;
    }
    string ShortWindowLabel(QuotaWindowDetail window) => window.Key switch
    {
        "five_hour" => "5h",
        "seven_day" => "wk",
        "seven_day_opus" => "Opus",
        "seven_day_sonnet" => "Son",
        _ => window.Label.Length <= 5 ? window.Label : window.Label[..4] + "…",
    };
    void AddSpend()
    {
        if (vm.Analytics is not { } a) return;
        var period = settings.Ui.SpendPeriod;
        var series = SpendSeries(a, period);
        var allZero = Sparkline.IsBaseline(series) && series.Length > 0;
        ContentPanel.Children.Add(new Separator { Margin = new(0, 2, 0, 6) });
        var strip = new StackPanel { Margin = new(0, 0, 0, 7) };
        var header = new DockPanel();
        var controls = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
        if (a.HasRecentData) controls.Children.Add(PeriodSelector(period));
        if (a.HasRecentData && !allZero) controls.Children.Add(StyleToggle());
        DockPanel.SetDock(controls, Dock.Right);
        header.Children.Add(controls);
        header.Children.Add(Section("SPEND"));
        strip.Children.Add(header);
        if (!a.HasRecentData)
        {
            strip.Children.Add(Muted(IdleCaption(a)));
            ContentPanel.Children.Add(strip);
            return;
        }
        var caption = new TextBlock { Text = SpendCaption(a, period), FontSize = 11, Margin = new(0, 2, 0, 0) };
        caption.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
        strip.Children.Add(caption);
        strip.Children.Add(new Sparkline { Values = series, ChartStyle = settings.Ui.ChartStyle, Height = 56, Margin = new(0, 4, 0, 2), Tag = "spend-chart" });
        strip.Children.Add(SpendAxisCanvas(period, a));
        ContentPanel.Children.Add(strip);
    }
    static double[] SpendSeries(BarAnalytics analytics, SpendPeriod period) => period switch
    {
        SpendPeriod.Today => [.. analytics.ByHour.Select(x => x.Cost)],
        SpendPeriod.Last7d => [.. analytics.ByDay.TakeLast(7).Select(x => x.Cost)],
        _ => [.. analytics.ByDay.Select(x => x.Cost)],
    };
    string SpendCaption(BarAnalytics analytics, SpendPeriod period) => period switch
    {
        // Each period sums the SAME series it charts so the caption always matches the visible bars.
        SpendPeriod.Today => $"today {BarFormatting.Money(analytics.ByHour.Count == 0 ? analytics.Today.Cost : analytics.ByHour.Sum(x => x.Cost))}",
        SpendPeriod.Last7d => $"7d {BarFormatting.Money(analytics.ByDay.TakeLast(7).Sum(x => x.Cost))}",
        _ => $"30d {BarFormatting.Money(analytics.Last30d.Cost)}",
    };
    string IdleCaption(BarAnalytics analytics)
    {
        var headline = analytics.DaysSinceLastActivity is { } days ? $"No usage in {days} days" : "No usage in 30 days";
        if (BarFormatting.LastActiveLabel(analytics.LastActivityAt, analytics.DaysSinceLastActivity, Now) is { } lastActive) headline += $" · {lastActive.ToLowerInvariant()}";
        return headline;
    }
    FrameworkElement PeriodSelector(SpendPeriod current)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal };
        foreach (var item in Enum.GetValues<SpendPeriod>())
        {
            var value = item;
            var selected = item == current;
            var label = item switch { SpendPeriod.Today => "Today", SpendPeriod.Last7d => "7d", _ => "30d" };
            var button = new Button
            {
                Content = label, FontSize = 10, FontWeight = selected ? FontWeights.SemiBold : FontWeights.Normal,
                Background = Brushes.Transparent, Padding = new(4, 0, 4, 0), Margin = new(2, 0, 0, 0),
            };
            AutomationProperties.SetName(button, $"Spend period {label}");
            button.SetResourceReference(Control.ForegroundProperty, selected ? "AccentBrush" : "MutedBrush");
            button.Click += (_, _) => { settings.Ui = settings.Ui with { SpendPeriod = value }; settings.Save(); Render(); };
            row.Children.Add(button);
        }
        return row;
    }
    Button StyleToggle()
    {
        var toLine = settings.Ui.ChartStyle == SpendChartStyle.Bars;
        var toggle = new Button
        {
            Content = toLine ? "Line" : "Bars", FontSize = 10, Background = Brushes.Transparent,
            Padding = new(4, 0, 4, 0), Margin = new(6, 0, 0, 0), ToolTip = $"Spend graph: switch to {(toLine ? "line" : "bars")}",
        };
        AutomationProperties.SetName(toggle, "Switch spend chart style");
        toggle.SetResourceReference(Control.ForegroundProperty, "MutedBrush");
        toggle.Click += (_, _) =>
        {
            settings.Ui = settings.Ui with { ChartStyle = settings.Ui.ChartStyle == SpendChartStyle.Bars ? SpendChartStyle.Line : SpendChartStyle.Bars };
            settings.Save(); Render();
        };
        return toggle;
    }
    FrameworkElement SpendAxisCanvas(SpendPeriod period, BarAnalytics analytics)
    {
        var canvas = new Canvas { Height = 12, Tag = "spend-axis" };
        var ticks = SpendAxis.Ticks(period, analytics.ByHour, analytics.ByDay);
        foreach (var (labelText, fraction) in ticks)
        {
            var label = new TextBlock { Text = labelText, FontSize = 9, FontFamily = (FontFamily)FindResource("FontFamily.Mono"), Tag = "axis-label" };
            label.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
            canvas.Children.Add(label);
        }
        void Layout()
        {
            if (canvas.ActualWidth <= 0 || canvas.Children.Count == 0) return;
            for (var i = 0; i < canvas.Children.Count; i++)
            {
                var label = (TextBlock)canvas.Children[i];
                // ~2.75 DIP per char at 9pt monospaced is half a glyph; clamp keeps first/last labels on-screen.
                var halfWidth = Math.Max(8, ticks[i].Label.Length * 2.75);
                var width = canvas.ActualWidth;
                var center = Math.Min(Math.Max(ticks[i].Fraction * width, halfWidth), Math.Max(halfWidth, width - halfWidth));
                Canvas.SetLeft(label, center - label.ActualWidth / 2);
                Canvas.SetTop(label, 1);
            }
        }
        canvas.SizeChanged += (_, _) => Layout();
        canvas.Loaded += (_, _) => Layout();
        return canvas;
    }
    void AddPool(IReadOnlyList<BarSummaryRow> subscriptions, IReadOnlyList<BarSummaryRow> pool)
    {
        if (pool.Count == 0) return;
        ContentPanel.Children.Add(Section(subscriptions.Count > 0 ? "Pool accounts" : "Accounts"));
        foreach (var row in pool) ContentPanel.Children.Add(PoolCard(row));
    }
    Border PoolCard(BarSummaryRow row)
    {
        var title = row.DisplayName ?? BarRows.AccountTitle(row);
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var dot = HealthDot(row);
        Grid.SetColumn(dot, 0);
        grid.Children.Add(dot);
        var center = new StackPanel { Margin = new(0, 0, 4, 0) };
        var titleRow = new DockPanel();
        var titleChips = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        if (row.IsDefault) titleChips.Children.Add(Chip("default", "AccentBrush"));
        if (row.Paused) titleChips.Children.Add(Chip("paused", "MutedBrush"));
        if (row.NeedsReauth) titleChips.Children.Add(Chip("reauth", "RedBrush"));
        if (BarRows.IsNativeSubscription(row)) titleChips.Children.Add(Chip("subscription", "SubscriptionBrush"));
        DockPanel.SetDock(titleChips, Dock.Right);
        titleRow.Children.Add(titleChips);
        titleRow.Children.Add(new TextBlock { Text = title, FontWeight = FontWeights.Medium, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center, Margin = new(0, 0, 7, 0) });
        center.Children.Add(titleRow);
        var detail = new StackPanel { Orientation = Orientation.Horizontal, Margin = new(0, 5, 0, 0) };
        detail.Children.Add(Chip(BarRows.ProviderLabel(row.Provider), BarRows.IsNativeSubscription(row) ? "SubscriptionBrush" : "AccentBrush"));
        if (row.Tier is { } tier) detail.Children.Add(Chip(tier, "MutedBrush"));
        detail.Children.Add(PoolGauge(row));
        center.Children.Add(detail);
        if (BarFormatting.LastActiveLabel(row.LastActivityAt, null, Now) is { } lastActive) center.Children.Add(new TextBlock { Text = lastActive, FontSize = 11, Margin = new(0, 5, 0, 0) });
        Grid.SetColumn(center, 1);
        grid.Children.Add(center);
        var right = new StackPanel();
        var cost = new TextBlock { Text = row.TodayCost is { } today ? BarFormatting.Money(today) : "no data", FontSize = row.TodayCost is { } ? 12 : 11, Opacity = row.TodayCost is { } ? 1 : 0.6, TextAlignment = TextAlignment.Right };
        if (row.TodayCost is { }) { cost.FontFamily = (FontFamily)FindResource("FontFamily.Mono"); cost.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush"); }
        else cost.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
        right.Children.Add(cost);
        var actions = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new(0, 3, 0, 0) };
        var toggle = SmallButton(row.Paused ? "Resume" : "Pause");
        AutomationProperties.SetName(toggle, $"{(row.Paused ? "Resume" : "Pause")} {title}");
        toggle.Click += async (_, _) => { if (row.Paused) await vm.ResumeAsync(row); else await vm.PauseAsync(row); };
        actions.Children.Add(toggle);
        var overflow = SmallButton("...");
        AutomationProperties.SetName(overflow, $"Actions for {title}");
        overflow.ContextMenu = ActionsMenu(row);
        overflow.Click += (_, _) => { overflow.ContextMenu.PlacementTarget = overflow; overflow.ContextMenu.IsOpen = true; };
        actions.Children.Add(overflow);
        right.Children.Add(actions);
        Grid.SetColumn(right, 2);
        grid.Children.Add(right);
        var card = Card(grid, 1, 8);
        card.Tag = "pool-card";
        return card;
    }
    FrameworkElement PoolGauge(BarSummaryRow row)
    {
        var label = BarFormatting.QuotaLabel(row.QuotaPercentage, row.QuotaStatus);
        var band = BarQuota.Band(row.QuotaPercentage, row.QuotaStatus);
        var fill = BarQuota.FillFraction(row.QuotaPercentage, row.QuotaStatus);
        if (band == QuotaBand.None || fill is null)
        {
            var fallback = new TextBlock { Text = label, FontSize = 11, VerticalAlignment = VerticalAlignment.Center, Margin = new(4, 0, 0, 0) };
            fallback.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
            return fallback;
        }
        var wrap = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center, Margin = new(4, 0, 0, 0) };
        var bar = new Grid { Width = 54, Height = 6, VerticalAlignment = VerticalAlignment.Center, Margin = new(0, 0, 5, 0), Tag = "pool-gauge" };
        var track = new Border { Height = 6, CornerRadius = new(3) };
        track.SetResourceReference(Border.BackgroundProperty, "TrackBrush");
        var fillBorder = new Border { Height = 6, CornerRadius = new(3), Width = Math.Max(2, 54 * fill.Value), HorizontalAlignment = HorizontalAlignment.Left };
        fillBorder.SetResourceReference(Border.BackgroundProperty, BandKey(band));
        bar.Children.Add(track); bar.Children.Add(fillBorder);
        AutomationProperties.SetName(bar, "Quota remaining");
        AutomationProperties.SetHelpText(bar, label);
        wrap.Children.Add(bar);
        var percent = new TextBlock { Text = label, FontFamily = (FontFamily)FindResource("FontFamily.Mono"), FontSize = 11, VerticalAlignment = VerticalAlignment.Center, Margin = new(0, 0, 5, 0) };
        percent.SetResourceReference(TextBlock.ForegroundProperty, BandKey(band));
        wrap.Children.Add(percent);
        if (BarQuota.ResetCountdown(row.NextReset, Now) is { } countdown)
        {
            var reset = new TextBlock { Text = countdown, FontSize = 11, Opacity = 0.6, VerticalAlignment = VerticalAlignment.Center };
            reset.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
            wrap.Children.Add(reset);
        }
        return wrap;
    }
    ContextMenu ActionsMenu(BarSummaryRow row)
    {
        var menu = new ContextMenu(); AutomationProperties.SetName(menu, $"Actions for {row.DisplayName ?? BarRows.AccountTitle(row)}"); void Add(string text, Func<Task> action) { var item = new MenuItem { Header = text }; AutomationProperties.SetName(item, text); item.Click += async (_, _) => await action(); menu.Items.Add(item); }
        Add("Set as default", () => vm.SetDefaultAsync(row)); Add("Solo (pause others)", () => vm.SoloAsync(row)); menu.Items.Add(new Separator());
        if (row.Tier is { } tier) Add($"Lock to {tier}", () => vm.TierLockAsync(row, tier));
        Add("Clear tier lock", () => vm.TierLockAsync(row, null)); return menu;
    }
    void AddBreakdown()
    {
        if (vm.Analytics is not { } a) return;
        if (a.BySurface.Count > 0)
        {
            ContentPanel.Children.Add(Section("BY SURFACE"));
            var peak = a.BySurface.Max(x => x.Cost);
            foreach (var item in a.BySurface.Take(5)) ContentPanel.Children.Add(BreakdownRow(item.Surface, item.Cost, item.Requests, peak, "SubscriptionBrush"));
        }
        if (a.TopModels.Count > 0)
        {
            ContentPanel.Children.Add(Section($"TOP MODELS · {(a.TopModelsWindow == "30d" ? "30D" : "ALL-TIME")}"));
            var peak = a.TopModels.Max(x => x.Cost);
            foreach (var item in a.TopModels.Take(4)) ContentPanel.Children.Add(BreakdownRow(item.Model, item.Cost, null, peak, "AccentBrush"));
        }
    }
    FrameworkElement BreakdownRow(string label, double cost, int? requests, double peak, string tintKey)
    {
        var grid = new Grid { Height = 26, Margin = new(0, 1, 0, 1), Tag = "breakdown-row" };
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var fraction = peak > 0 ? cost / peak : 0;
        var fill = new Border { CornerRadius = new(5), HorizontalAlignment = HorizontalAlignment.Left, Tag = "breakdown-fill", Opacity = 0.16 };
        fill.SetResourceReference(Border.BackgroundProperty, tintKey);
        Grid.SetColumnSpan(fill, 2);
        grid.Children.Add(fill);
        var name = new TextBlock { Text = label, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center, Margin = new(10, 0, 10, 0) };
        Grid.SetColumn(name, 0);
        grid.Children.Add(name);
        var right = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center, Margin = new(0, 0, 10, 0) };
        if (requests is { } count)
        {
            var requestsText = new TextBlock { Text = BarFormatting.Count(count), FontFamily = (FontFamily)FindResource("FontFamily.Mono"), FontSize = 11, Opacity = 0.75, VerticalAlignment = VerticalAlignment.Center, Margin = new(0, 0, 6, 0) };
            requestsText.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
            right.Children.Add(requestsText);
        }
        var money = new TextBlock { Text = BarFormatting.Money(cost), FontFamily = (FontFamily)FindResource("FontFamily.Mono"), FontSize = 11, VerticalAlignment = VerticalAlignment.Center };
        money.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
        right.Children.Add(money);
        Grid.SetColumn(right, 1);
        grid.Children.Add(right);
        grid.SizeChanged += (_, _) =>
        {
            fill.Width = Math.Max(8, grid.ActualWidth * fraction);
            // Middle truncation budget: full row minus padding plus whatever the right cluster needs.
            var reserved = 20 + right.DesiredSize.Width;
            name.Text = TextFit.Fit(label, Math.Max(24, grid.ActualWidth - reserved), name.FontFamily, name.FontSize);
        };
        return grid;
    }
    FrameworkElement HealthDot(BarSummaryRow row)
    {
        var key = row.Health == "error" ? "RedBrush" : row.Health == "warning" ? "AmberBrush" : "GreenBrush";
        var dot = new Ellipse { Width = 8, Height = 8, VerticalAlignment = VerticalAlignment.Top, Margin = new(0, 5, 8, 0), Tag = "health-dot" };
        dot.SetResourceReference(Shape.FillProperty, key);
        AutomationProperties.SetName(dot, $"{row.Health} status");
        return dot;
    }
    Border Chip(string text, string tintKey)
    {
        var border = new Border { CornerRadius = new CornerRadius(100), Padding = new(5, 1.5, 5, 1.5), VerticalAlignment = VerticalAlignment.Center, Margin = new(4, 0, 0, 0), Background = Tinted(tintKey, 0.22) };
        border.Child = new TextBlock { Style = (Style)FindResource("CcsChipText"), Text = text, Foreground = ChipForeground(tintKey) };
        return border;
    }
    SolidColorBrush Tinted(string key, double opacity)
    {
        var color = ((SolidColorBrush)FindResource(key)).Color;
        return new SolidColorBrush(Color.FromArgb((byte)Math.Round(opacity * 255), color.R, color.G, color.B));
    }
    Brush ChipForeground(string tintKey)
    {
        if (tintKey == "MutedBrush") return (Brush)FindResource("MutedBrush");
        var tint = ((SolidColorBrush)FindResource(tintKey)).Color;
        var text = ((SolidColorBrush)FindResource("TextBrush")).Color;
        var target = text.R + text.G + text.B > 384 ? Colors.White : Colors.Black;
        return new SolidColorBrush(Color.FromRgb((byte)((tint.R + target.R) / 2), (byte)((tint.G + target.G) / 2), (byte)((tint.B + target.B) / 2)));
    }
    DockPanel SectionHeader(string title, string? trailing)
    {
        var dock = new DockPanel();
        if (trailing is { } hint)
        {
            var text = new TextBlock { Text = hint, FontSize = 10, FontWeight = FontWeights.Medium, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Bottom, Margin = new(0, 5, 0, 4) };
            text.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
            DockPanel.SetDock(text, Dock.Right);
            dock.Children.Add(text);
        }
        dock.Children.Add(Section(title));
        return dock;
    }
    TextBlock ProviderCaption(string label)
    {
        var caption = new TextBlock { Text = label, FontSize = 10, FontWeight = FontWeights.SemiBold, Margin = new(0, 2, 0, 2) };
        caption.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
        return caption;
    }
    string BandKey(QuotaBand band) => band switch { QuotaBand.Green => "GreenBrush", QuotaBand.Yellow => "AmberBrush", QuotaBand.Orange => "CoralBrush", QuotaBand.Red => "RedBrush", _ => "MutedBrush" };
    Border Card(UIElement child, double opacity = 1, double radius = 9) => new() { Child = child, Background = (Brush)FindResource("CardBrush"), CornerRadius = new(radius), Padding = new(10, 8, 10, 8), Margin = new(0, 0, 0, 7), Opacity = opacity };
    TextBlock Section(string text) { var label = new TextBlock { Text = text.ToUpperInvariant(), FontSize = 11, FontWeight = FontWeights.Bold, Margin = new(0, 5, 0, 4) }; label.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush"); return label; }
    TextBlock Muted(string text) => new() { Text = text, FontSize = 11, Foreground = (Brush)FindResource("MutedBrush"), TextWrapping = TextWrapping.Wrap, Margin = new(0, 3, 0, 2) };
    Border Banner(string title, string body, string brush) { var stack = new StackPanel(); var heading = new TextBlock { Text = title, FontWeight = FontWeights.SemiBold }; heading.SetResourceReference(TextBlock.ForegroundProperty, brush); stack.Children.Add(heading); stack.Children.Add(Muted(body)); return Card(stack); }
    System.Windows.Controls.Button SmallButton(string text) { var button = new Button { Content = text, Padding = new(6, 2, 6, 2), Margin = new(2), FontSize = 11 }; AutomationProperties.SetName(button, text); return button; }
    FrameworkElement UpdateBanner()
    {
        var wrap = new StackPanel { Margin = new(0, 0, 0, 7) };
        wrap.Children.Add(Section("UPDATE"));
        var card = new Border { CornerRadius = new(8), Padding = new(10, 6, 10, 6), Tag = "update-banner", Background = Tinted("AccentBrush", 0.10) };
        var dock = new DockPanel();
        var icon = new TextBlock { Text = "\uE896", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 16, VerticalAlignment = VerticalAlignment.Center, Margin = new(0, 0, 10, 0) };
        icon.SetResourceReference(TextBlock.ForegroundProperty, "AccentBrush");
        DockPanel.SetDock(icon, Dock.Left);
        dock.Children.Add(icon);
        var action = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        DockPanel.SetDock(action, Dock.Right);
        if (vm.IsInstallingUpdate)
        {
            var progress = new ProgressBar { Width = 14, Height = 14, IsIndeterminate = true, Tag = "update-progress", VerticalAlignment = VerticalAlignment.Center };
            action.Children.Add(progress);
            var updating = new TextBlock { Text = "Updating...", FontSize = 11, VerticalAlignment = VerticalAlignment.Center, Margin = new(6, 0, 0, 0) };
            updating.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
            action.Children.Add(updating);
        }
        else
        {
            var now = new Button { Content = "Update Now", Background = Brushes.Transparent, Padding = new(6, 2, 6, 2), FontWeight = FontWeights.Medium };
            AutomationProperties.SetName(now, "Install CCS Bar update");
            now.SetResourceReference(Control.ForegroundProperty, "AccentBrush");
            now.Click += InstallUpdate_Click;
            action.Children.Add(now);
        }
        dock.Children.Add(action);
        var texts = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        texts.Children.Add(new TextBlock { Text = "Update available", FontSize = 12, FontWeight = FontWeights.SemiBold });
        if (vm.LatestVersion is { } version)
        {
            var label = new TextBlock { Text = $"CCS Bar {version}", FontSize = 11, Margin = new(0, 1, 0, 0) };
            label.SetResourceReference(TextBlock.ForegroundProperty, "MutedBrush");
            texts.Children.Add(label);
        }
        dock.Children.Add(texts);
        card.Child = dock;
        wrap.Children.Add(card);
        if (updateError is { } error)
        {
            var inline = new TextBlock { Text = error, FontSize = 11, Tag = "update-error", TextWrapping = TextWrapping.Wrap, Margin = new(2, 4, 2, 0) };
            inline.SetResourceReference(TextBlock.ForegroundProperty, "RedBrush");
            wrap.Children.Add(inline);
        }
        return wrap;
    }
    void InstallUpdate_Click(object sender, RoutedEventArgs e)
    {
        if (vm.IsInstallingUpdate) return;
        updateError = null;
        vm.IsInstallingUpdate = true;
        Render();
        try { installUpdate(); }
        catch (Exception exception)
        {
            // A failed launch restores the action; a successful hand-off keeps the
            // progress state until the installer swaps and relaunches the app.
            updateError = exception.Message;
            vm.IsInstallingUpdate = false;
        }
        Render();
    }
    async void Refresh_Click(object sender, RoutedEventArgs e) => await vm.ForceRefreshAsync(); async void Retry_Click(object sender, RoutedEventArgs e) => await vm.RetryAsync(); async void Start_Click(object sender, RoutedEventArgs e) => await vm.StartAsync();
    void Icon_Click(object sender, RoutedEventArgs e) { settings.Ui = settings.Ui with { IconStyle = settings.Ui.IconStyle == BarIconStyle.Color ? BarIconStyle.Template : BarIconStyle.Color }; settings.Save(); ((App)Application.Current).SettingsChanged(); }
    void Dashboard_Click(object sender, RoutedEventArgs e) { if (vm.ActiveBaseUrl is not null) try { new DashboardLauncher(WindowsProcess.Start).Open(vm.ActiveBaseUrl); } catch (Exception ex) { System.Windows.MessageBox.Show(ex.Message, "CCS Bar", MessageBoxButton.OK, MessageBoxImage.Error); } Hide(); }
    void Settings_Click(object sender, RoutedEventArgs e) { settingsWindow ??= new SettingsWindow(vm, (JsonBarSettings)settings) { Owner = null }; settingsWindow.Closed += (_, _) => settingsWindow = null; settingsWindow.Show(); settingsWindow.Activate(); }
    void Quit_Click(object sender, RoutedEventArgs e) { if (!quitArmed) { quitArmed = true; QuitGlyph.Text = "\uEA14"; QuitButton.Foreground = (Brush)FindResource("RedBrush"); QuitButton.ToolTip = "Click to confirm quit"; return; } ((App)Application.Current).Exit(); }
    void Window_Deactivated(object sender, EventArgs e) { if (settingsWindow?.IsActive != true && activationGuard.ShouldHide(Now)) Hide(); } void Window_KeyDown(object sender, System.Windows.Input.KeyEventArgs e) { if (e.Key == Key.Escape) Hide(); }
}

public sealed class PanelActivationGuard(TimeSpan? grace = null)
{
    enum ActivationState { Settling, Armed }
    readonly TimeSpan graceWindow = grace ?? TimeSpan.FromMilliseconds(250);
    DateTimeOffset activatedAt;
    ActivationState state = ActivationState.Armed;

    public void Activated(DateTimeOffset now) { activatedAt = now; state = ActivationState.Settling; }
    public bool ShouldHide(DateTimeOffset now)
    {
        if (state == ActivationState.Settling && now - activatedAt < graceWindow) return false;
        state = ActivationState.Armed;
        return true;
    }
}

/// <summary>
/// Alert presentation helpers mirroring BarMenuView: de-duplicate alerts by their
/// visible text and rank by severity so the most actionable condition leads.
/// </summary>
public static class AlertDisplay
{
    public static int SeverityRank(BarAlertKind kind) => kind switch
    {
        BarAlertKind.ReauthNeeded => 0,
        BarAlertKind.DailySpendAbove or BarAlertKind.MonthSpendAbove => 1,
        BarAlertKind.QuotaRemainingBelow => 2,
        _ => 3,
    };

    public static IReadOnlyList<AlertGroup> Group(IEnumerable<BarNotification> alerts)
    {
        var order = new List<string>();
        var byKey = new Dictionary<string, (BarNotification Alert, int Count)>();
        foreach (var alert in alerts)
        {
            var key = alert.Title + "\u001F" + alert.Body;
            if (byKey.TryGetValue(key, out var hit)) byKey[key] = (hit.Alert, hit.Count + 1);
            else { byKey[key] = (alert, 1); order.Add(key); }
        }
        return [.. order.Select(key => new AlertGroup(byKey[key].Alert, byKey[key].Count)).OrderBy(group => SeverityRank(group.Alert.Kind))];
    }
}

public sealed record AlertGroup(BarNotification Alert, int Count);

/// <summary>Middle truncation for long surface/model labels (WPF lacks a middle-trim mode).</summary>
public static class TextFit
{
    public static string MiddleEllipsis(string value, int maxChars)
    {
        if (maxChars < 1) maxChars = 1;
        if (value.Length <= maxChars) return value;
        var head = (maxChars - 1) / 2;
        var tail = maxChars - 1 - head;
        return tail > 0 ? value[..head] + "…" + value[^tail..] : value[..head] + "…";
    }

    public static string Fit(string value, double maxWidth, FontFamily family, double fontSize, double pixelsPerDip = 1.0)
    {
        if (Measure(value, family, fontSize, pixelsPerDip) <= maxWidth) return value;
        int low = 1, high = value.Length, best = 1;
        while (low <= high)
        {
            var mid = (low + high) / 2;
            if (Measure(MiddleEllipsis(value, mid), family, fontSize, pixelsPerDip) <= maxWidth) { best = mid; low = mid + 1; }
            else high = mid - 1;
        }
        return MiddleEllipsis(value, Math.Max(best, 3));
    }

    static double Measure(string text, FontFamily family, double fontSize, double pixelsPerDip) =>
        new FormattedText(text, System.Globalization.CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
            new Typeface(family, FontStyles.Normal, FontWeights.Regular, FontStretches.Normal), fontSize, Brushes.Black, pixelsPerDip).Width;
}
