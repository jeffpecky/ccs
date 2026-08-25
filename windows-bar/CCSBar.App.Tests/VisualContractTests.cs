using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using CCSBar.App;
using CCSBar.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace CCSBar.App.Tests;

[TestClass]
public sealed class VisualContractTests
{
    static readonly string ProjectRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
    static readonly string AppXamlPath = Path.Combine(ProjectRoot, "CCSBar.App", "App.xaml");
    static readonly string MainWindowXamlPath = Path.Combine(ProjectRoot, "CCSBar.App", "MainWindow.xaml");
    static readonly string SettingsWindowXamlPath = Path.Combine(ProjectRoot, "CCSBar.App", "SettingsWindow.xaml");
    static readonly string MainWindowCodePath = Path.Combine(ProjectRoot, "CCSBar.App", "MainWindow.xaml.cs");
    static readonly string AppCodePath = Path.Combine(ProjectRoot, "CCSBar.App", "App.xaml.cs");
    static readonly string SwiftThemePath = Path.GetFullPath(Path.Combine(ProjectRoot, "..", "macos-bar", "Sources", "CCSBarCore", "BarTheme.swift"));
    static readonly string ControlsDir = Path.Combine(ProjectRoot, "CCSBar.App", "Controls");

    static App? s_app;
    static ResourceDictionary? s_resources;

    [ClassInitialize]
    public static void ClassInit(TestContext context)
    {
        // Create a single Application instance for all tests
        s_app = new App();
        s_app.InitializeComponent();
        s_resources = s_app.Resources;
    }

    [TestMethod]
    public void BarThemePalette_Dark_MatchesSwiftSourceValues()
    {
        CollectionAssert.AreEqual(SwiftPalette("dark"), ThemeColors(BarThemePalette.Dark));
    }

    [TestMethod]
    public void BarThemePalette_Light_MatchesSwiftSourceValues()
    {
        CollectionAssert.AreEqual(SwiftPalette("light"), ThemeColors(BarThemePalette.Light));
    }

    [STATestMethod]
    public void RuntimeCreatedControls_ResolveSharedImplicitStyles()
    {
        foreach (var control in new FrameworkElement[] { new Button(), new MenuItem(), new Separator(), new ProgressBar(), new ContextMenu(), new ToolTip() })
        {
            var style = (Style)s_resources![control.GetType()];
            Assert.AreEqual(control.GetType(), style.TargetType, $"Implicit {control.GetType().Name} style missing");
        }
    }

    [STATestMethod]
    public void DeterminateProgressBar_RendersValueThroughTemplateParts()
    {
        var progress = new ProgressBar { Style = (Style)s_resources![typeof(ProgressBar)], Minimum = 0, Maximum = 100, Value = 50, Width = 200, Height = 8 };
        progress.Measure(new Size(200, 8));
        progress.Arrange(new Rect(0, 0, 200, 8));
        progress.ApplyTemplate();
        progress.UpdateLayout();

        var track = (FrameworkElement)progress.Template.FindName("PART_Track", progress);
        var indicator = (FrameworkElement)progress.Template.FindName("PART_Indicator", progress);
        Assert.IsTrue(track.ActualWidth > 0);
        Assert.AreEqual(track.ActualWidth / 2, indicator.ActualWidth, 1);
    }

    [TestMethod]
    public void RuntimeControlSource_IsCoveredByImplicitResources()
    {
        var source = File.ReadAllText(MainWindowCodePath);
        var created = Regex.Matches(source, @"new\s+(?:System\.Windows\.Controls\.)?(Button|MenuItem|Separator|ProgressBar|ContextMenu|ToolTip)\b")
            .Select(match => match.Groups[1].Value)
            .Distinct();

        foreach (var name in created)
        {
            var type = typeof(Control).Assembly.GetType($"System.Windows.Controls.{name}")!;
            Assert.IsNotNull(s_resources![type], $"Code-created {name} lacks implicit shared style");
        }
    }

    [TestMethod]
    public void SystemTheme_UsesWindowsPreferenceAndSubscribesToChanges()
    {
        var source = File.ReadAllText(AppCodePath);
        StringAssert.Contains(source, "AppsUseLightTheme");
        StringAssert.Contains(source, "SystemEvents.UserPreferenceChanged");
        Assert.IsFalse(source.Contains("WindowGlassColor"));
    }

    [TestMethod]
    public void CustomControls_PreserveFocusAndAccessibleNames()
    {
        var buttons = File.ReadAllText(Path.Combine(ControlsDir, "CcsButton.xaml"));
        StringAssert.Contains(buttons, "CcsFocusVisual");
        Assert.IsFalse(buttons.Contains("FocusVisualStyle\" Value=\"{x:Null}"));

        var main = File.ReadAllText(MainWindowXamlPath);
        Assert.AreEqual(Regex.Matches(main, @"<Button\b").Count, Regex.Matches(main, @"<Button\b[^>]*AutomationProperties\.Name=").Count);
    }

    [TestMethod]
    public void PrimaryInteractionColors_AndDarkMaterial_AreThemeDerived()
    {
        var buttons = File.ReadAllText(Path.Combine(ControlsDir, "CcsButton.xaml"));
        StringAssert.Contains(buttons, "PrimaryHoverBrush");
        StringAssert.Contains(buttons, "PrimaryPressedBrush");

        App.ApplyTheme(BarAppearance.Dark);
        var window = ((SolidColorBrush)s_resources!["WindowBrush"]).Color;
        Assert.IsTrue(window.A < byte.MaxValue, "Dark window surface must allow native transparency/acrylic fallback");
    }

    static string[] ThemeColors(BarThemePalette palette) =>
        [palette.Accent, palette.Subscription, palette.Green, palette.Amber, palette.Coral, palette.Red, palette.WindowSurface];

    static string[] SwiftPalette(string appearance)
    {
        var source = File.ReadAllText(SwiftThemePath);
        var block = Regex.Match(source, $@"public static let {appearance} = BarPalette\((?<body>.*?)\n  \)", RegexOptions.Singleline).Groups["body"].Value;
        return Regex.Matches(block, @"//\s*(#[0-9A-Fa-f]{6}|unused in dark)")
            .Select(match => match.Groups[1].Value == "unused in dark" ? "Transparent" : match.Groups[1].Value.ToUpperInvariant())
            .ToArray();
    }

    [TestMethod]
    public void AppResources_DefineAllRequiredColorTokens()
    {
        var resources = s_resources!;

        // Core palette tokens
        Assert.IsNotNull(resources["AccentBrush"], "AccentBrush missing");
        Assert.IsNotNull(resources["SubscriptionBrush"], "SubscriptionBrush missing");
        Assert.IsNotNull(resources["GreenBrush"], "GreenBrush missing");
        Assert.IsNotNull(resources["AmberBrush"], "AmberBrush missing");
        Assert.IsNotNull(resources["CoralBrush"], "CoralBrush missing");
        Assert.IsNotNull(resources["RedBrush"], "RedBrush missing");

        // Surface tokens
        Assert.IsNotNull(resources["WindowBrush"], "WindowBrush missing");
        Assert.IsNotNull(resources["CardBrush"], "CardBrush missing");
        Assert.IsNotNull(resources["TrackBrush"], "TrackBrush missing");

        // Text tokens
        Assert.IsNotNull(resources["TextBrush"], "TextBrush missing");
        Assert.IsNotNull(resources["MutedBrush"], "MutedBrush missing");

        // Border token
        Assert.IsNotNull(resources["BorderBrush"], "BorderBrush missing");
    }

    [TestMethod]
    public void AppResources_DefineTypographyTokens()
    {
        var resources = s_resources!;

        // Font families
        Assert.IsNotNull(resources["FontFamily.UI"], "FontFamily.UI missing");
        Assert.IsNotNull(resources["FontFamily.Mono"], "FontFamily.Mono missing");

        // Font sizes (matching SwiftUI: headline, body, caption, caption2, section label)
        Assert.IsNotNull(resources["FontSize.Headline"], "FontSize.Headline missing");
        Assert.IsNotNull(resources["FontSize.Body"], "FontSize.Body missing");
        Assert.IsNotNull(resources["FontSize.Caption"], "FontSize.Caption missing");
        Assert.IsNotNull(resources["FontSize.Caption2"], "FontSize.Caption2 missing");
        Assert.IsNotNull(resources["FontSize.SectionLabel"], "FontSize.SectionLabel missing");

        // Font weights
        Assert.IsNotNull(resources["FontWeight.Regular"], "FontWeight.Regular missing");
        Assert.IsNotNull(resources["FontWeight.Medium"], "FontWeight.Medium missing");
        Assert.IsNotNull(resources["FontWeight.Semibold"], "FontWeight.Semibold missing");
        Assert.IsNotNull(resources["FontWeight.Bold"], "FontWeight.Bold missing");
    }

    [TestMethod]
    public void AppResources_DefineSpacingTokens()
    {
        var resources = s_resources!;

        // Spacing scale matching SwiftUI: 4, 5, 6, 7, 8, 10, 11, 12, 14
        Assert.IsNotNull(resources["Spacing.4"], "Spacing.4 missing");
        Assert.IsNotNull(resources["Spacing.5"], "Spacing.5 missing");
        Assert.IsNotNull(resources["Spacing.6"], "Spacing.6 missing");
        Assert.IsNotNull(resources["Spacing.7"], "Spacing.7 missing");
        Assert.IsNotNull(resources["Spacing.8"], "Spacing.8 missing");
        Assert.IsNotNull(resources["Spacing.10"], "Spacing.10 missing");
        Assert.IsNotNull(resources["Spacing.11"], "Spacing.11 missing");
        Assert.IsNotNull(resources["Spacing.12"], "Spacing.12 missing");
        Assert.IsNotNull(resources["Spacing.14"], "Spacing.14 missing");
    }

    [TestMethod]
    public void AppResources_DefineRadiusTokens()
    {
        var resources = s_resources!;

        Assert.IsNotNull(resources["Radius.Small"], "Radius.Small missing"); // 4-5
        Assert.IsNotNull(resources["Radius.Medium"], "Radius.Medium missing"); // 8-9
        Assert.IsNotNull(resources["Radius.Large"], "Radius.Large missing"); // 12
    }

    [TestMethod]
    public void AppResources_DefineShadowTokens()
    {
        var resources = s_resources!;

        // SwiftUI uses native MenuBarExtra material; WPF needs explicit shadow for the panel
        Assert.IsNotNull(resources["PanelShadow"], "PanelShadow missing");
        Assert.IsNotNull(resources["CardShadow"], "CardShadow missing");
    }

    [TestMethod]
    public void AppResources_DefineCustomControlTemplates()
    {
        var resources = s_resources!;

        // All custom control templates replacing stock WPF chrome
        var keys = new[]
        {
            "CcsButtonTemplate", "CcsChipTemplate", "CcsCheckBoxTemplate",
            "CcsComboBoxTemplate", "CcsProgressBarTemplate", "CcsMenuItemTemplate",
            "CcsScrollBarTemplate", "CcsSeparatorTemplate", "CcsToolTipTemplate"
        };

        foreach (var key in keys)
        {
            try
            {
                var value = resources[key];
                Assert.IsNotNull(value, $"{key} missing");
            }
            catch (Exception ex)
            {
                Assert.Fail($"{key} threw: {ex.Message}");
            }
        }
    }

    [TestMethod]
    public void ProductXaml_UsesOnlyDynamicResourceForThemeTokens()
    {
        var xamlFiles = new[] { MainWindowXamlPath, SettingsWindowXamlPath };
        if (Directory.Exists(ControlsDir))
        {
            xamlFiles = xamlFiles.Concat(Directory.GetFiles(ControlsDir, "*.xaml")).ToArray();
        }

        var tokenKeys = new[]
        {
            "AccentBrush", "SubscriptionBrush", "GreenBrush", "AmberBrush", "CoralBrush", "RedBrush",
            "WindowBrush", "CardBrush", "TrackBrush", "TextBrush", "MutedBrush", "BorderBrush"
        };

        foreach (var file in xamlFiles)
        {
            var content = File.ReadAllText(file);
            foreach (var key in tokenKeys)
            {
                // Find all references to this token
                var staticPattern = $@"\{{\s*StaticResource\s+{key}\s*}}";
                var matches = Regex.Matches(content, staticPattern, RegexOptions.IgnoreCase);
                Assert.AreEqual(0, matches.Count,
                    $"File {Path.GetFileName(file)} uses StaticResource for {key}. Theme tokens must use DynamicResource to support runtime theme switching.");
            }
        }
    }

    [TestMethod]
    public void CustomControls_ExistInControlsDirectory()
    {
        // Controls reused at least twice should exist in Controls/
        var expectedControls = new[]
        {
            "CcsButton.xaml",
            "CcsChip.xaml",
            "CcsCheckBox.xaml",
            "CcsComboBox.xaml",
            "CcsProgressBar.xaml",
            "CcsMenuItem.xaml",
            "CcsScrollBar.xaml",
            "CcsSeparator.xaml",
            "CcsToolTip.xaml",
        };

        foreach (var control in expectedControls)
        {
            var path = Path.Combine(ControlsDir, control);
            Assert.IsTrue(File.Exists(path), $"Required control {control} missing from Controls/ directory");
        }
    }

    [TestMethod]
    public void WindowDimensions_MatchMacOSReference()
    {
        // macOS BarMenuView uses 360 width (line 178)
        var content = File.ReadAllText(MainWindowXamlPath);
        Assert.IsTrue(content.Contains("Width=\"360\"") || content.Contains("Width=360"),
            "MainWindow width must be 360 to match macOS reference");
    }

    [STATestMethod]
    public void MainWindow_RuntimeShell_MatchesMacOSGeometryAndStates()
    {
        var connector = new TestConnector();
        var vm = new BarViewModel(connector, new TestSettings());
        var window = CreateMainWindow(vm);
        try
        {
            window.Measure(new Size(360, 900));
            window.Arrange(new Rect(0, 0, 360, window.DesiredSize.Height));
            window.UpdateLayout();

            Assert.AreEqual(360, window.Width);
            Assert.AreEqual(new Thickness(14, 10, 14, 10), ((Grid)window.FindName("Header")).Margin);
            Assert.AreEqual(24, ((Image)window.FindName("HeaderLogo")).Width);
            Assert.AreEqual(24, ((Image)window.FindName("HeaderLogo")).Height);
            Assert.AreEqual("CCS", ((TextBlock)window.FindName("HeaderTitle")).Text);
            Assert.AreEqual("usage & accounts", ((TextBlock)window.FindName("HeaderSubtitle")).Text);
            var version = File.ReadAllText(Path.Combine(ProjectRoot, "..", "macos-bar", "VERSION")).Trim();
            Assert.AreEqual($"v{version}", ((TextBlock)window.FindName("VersionText")).Text);
            Assert.AreEqual(new Thickness(14, 11, 14, 11), ((Grid)window.FindName("Footer")).Margin);
            Assert.AreEqual(0, ((ScrollViewer)window.FindName("ContentScroll")).MinHeight);
            Assert.AreEqual(780, ((ScrollViewer)window.FindName("ContentScroll")).MaxHeight);

            vm.RetryAsync().GetAwaiter().GetResult();
            window.Render();
            Assert.AreEqual(Visibility.Visible, ((FrameworkElement)window.FindName("OfflinePanel")).Visibility);
            Assert.AreEqual("CCS is not running", ((TextBlock)window.FindName("OfflineTitle")).Text);
            Assert.AreEqual("Start CCS, then the menu will connect automatically.", ((TextBlock)window.FindName("OfflineBody")).Text);
            Assert.AreEqual(Visibility.Visible, ((FrameworkElement)window.FindName("OfflineActions")).Visibility);
            Assert.AreEqual(Visibility.Collapsed, ((FrameworkElement)window.FindName("StartingProgress")).Visibility);

            connector.Block = true;
            var start = vm.StartAsync();
            window.Render();
            Assert.AreEqual("Starting CCS…", ((TextBlock)window.FindName("OfflineTitle")).Text);
            Assert.AreEqual(Visibility.Collapsed, ((FrameworkElement)window.FindName("OfflineActions")).Visibility);
            Assert.AreEqual(Visibility.Visible, ((FrameworkElement)window.FindName("StartingProgress")).Visibility);
            connector.Release.SetResult();
            start.GetAwaiter().GetResult();

            window.Render();
            Assert.AreEqual(Visibility.Visible, ((FrameworkElement)window.FindName("EmptyState")).Visibility);
            Assert.AreEqual("No accounts configured", ((TextBlock)window.FindName("EmptyStateText")).Text);
        }
        finally { window.Detach(); window.Close(); }
    }

    [STATestMethod]
    public void MainWindow_RuntimeFooter_PreservesMacOSControlOrder()
    {
        var window = CreateMainWindow(new BarViewModel(new TestConnector(), new TestSettings()));
        try
        {
            var left = ((StackPanel)window.FindName("FooterPrimary")).Children.Cast<Button>().Select(x => x.Content?.ToString()).ToArray();
            var right = ((StackPanel)window.FindName("FooterActions")).Children.OfType<Button>().Where(x => x.Visibility == Visibility.Visible).Select(x => x.ToolTip?.ToString()).ToArray();
            CollectionAssert.AreEqual(new[] { "Dashboard", "Icon", "Settings" }, left);
            CollectionAssert.AreEqual(new[] { "Refresh", "Quit CCS Bar (click again to confirm)" }, right);
        }
        finally { window.Detach(); window.Close(); }
    }

    [TestMethod]
    public void DevelopmentAssembly_UsesMacOSVersionFile()
    {
        var expected = File.ReadAllText(Path.Combine(ProjectRoot, "..", "macos-bar", "VERSION")).Trim();
        Assert.AreEqual(expected, typeof(MainWindow).Assembly.GetName().Version?.ToString(3));
        Assert.AreEqual(expected, typeof(MainWindow).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion);
        Assert.AreNotEqual("1.0.0", expected);
    }

    static MainWindow CreateMainWindow(BarViewModel vm)
    {
        var settingsType = typeof(MainWindow).Assembly.GetType("CCSBar.App.JsonBarSettings")!;
        var settings = Activator.CreateInstance(settingsType, nonPublic: true)!;
        return (MainWindow)Activator.CreateInstance(typeof(MainWindow), BindingFlags.Instance | BindingFlags.NonPublic, null, [vm, settings], null)!;
    }

    sealed class TestConnector : IBarConnector
    {
        public bool Block { get; set; }
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task<IBarDataClient?> ConnectAsync(bool launch, CancellationToken cancellationToken)
        {
            if (Block) { Started.SetResult(); await Release.Task.WaitAsync(cancellationToken); }
            return launch ? new EmptyClient() : null;
        }
    }

    sealed class EmptyClient : IBarDataClient
    {
        public Task<IReadOnlyList<BarSummaryRow>> SummaryAsync(bool force, CancellationToken ct) => Task.FromResult<IReadOnlyList<BarSummaryRow>>([]);
        public Task<BarAnalytics?> AnalyticsAsync(CancellationToken ct) => Task.FromResult<BarAnalytics?>(null);
        public Task PauseAsync(BarSummaryRow row, CancellationToken ct) => Task.CompletedTask;
        public Task ResumeAsync(BarSummaryRow row, CancellationToken ct) => Task.CompletedTask;
        public Task SoloAsync(BarSummaryRow row, CancellationToken ct) => Task.CompletedTask;
        public Task SetDefaultAsync(BarSummaryRow row, CancellationToken ct) => Task.CompletedTask;
        public Task TierLockAsync(BarSummaryRow row, string? tier, CancellationToken ct) => Task.CompletedTask;
    }

    sealed class TestSettings : IBarSettings
    {
        public BarUiSettings Ui { get; set; } = new();
        public BarPreferences Alerts { get; set; } = new();
        public IReadOnlySet<string> FiredKeys { get; set; } = new HashSet<string>();
        public void Save() { }
    }

    [TestMethod]
    public void PanelCornerRadius_MatchesMacOSReference()
    {
        // macOS uses 12 for window, 8-9 for cards (BarSubscriptionCard line 49)
        var resources = s_resources!;

        var windowRadius = (CornerRadius)resources["Radius.Large"];
        Assert.AreEqual(12, windowRadius.TopLeft, "Window corner radius must be 12");

        var cardRadius = (CornerRadius)resources["Radius.Medium"];
        Assert.AreEqual(8, cardRadius.TopLeft, "Card corner radius must be 8 (matching macOS 8-9)");
    }

    [TestMethod]
    public void SpacingTokens_MatchSwiftUIValues()
    {
        var resources = s_resources!;

        // Verify spacing values match SwiftUI usage
        Assert.AreEqual(4.0, ((Thickness)resources["Spacing.4"]).Left, "Spacing.4 = 4");
        Assert.AreEqual(5.0, ((Thickness)resources["Spacing.5"]).Left, "Spacing.5 = 5");
        Assert.AreEqual(6.0, ((Thickness)resources["Spacing.6"]).Left, "Spacing.6 = 6");
        Assert.AreEqual(7.0, ((Thickness)resources["Spacing.7"]).Left, "Spacing.7 = 7");
        Assert.AreEqual(8.0, ((Thickness)resources["Spacing.8"]).Left, "Spacing.8 = 8");
        Assert.AreEqual(10.0, ((Thickness)resources["Spacing.10"]).Left, "Spacing.10 = 10");
        Assert.AreEqual(11.0, ((Thickness)resources["Spacing.11"]).Left, "Spacing.11 = 11");
        Assert.AreEqual(12.0, ((Thickness)resources["Spacing.12"]).Left, "Spacing.12 = 12");
        Assert.AreEqual(14.0, ((Thickness)resources["Spacing.14"]).Left, "Spacing.14 = 14");
    }

    [TestMethod]
    public void FontSizes_MatchSwiftUIValues()
    {
        var resources = s_resources!;

        // SwiftUI font sizes from BarMenuView:
        // - Headline: ~17 (system headline)
        // - Body: ~14 (system body)
        // - Caption: ~12 (system caption)
        // - Caption2: ~11 (system caption2)
        // - SectionLabel: 11 bold uppercase (BarAnalyticsView line 336)
        // - Chip: 10 semibold (Chip line 999)
        // - Window bar label: caption2 monospaced (BarSubscriptionCard line 136-139)
        Assert.AreEqual(17.0, (double)resources["FontSize.Headline"], "Headline = 17");
        Assert.AreEqual(14.0, (double)resources["FontSize.Body"], "Body = 14");
        Assert.AreEqual(12.0, (double)resources["FontSize.Caption"], "Caption = 12");
        Assert.AreEqual(11.0, (double)resources["FontSize.Caption2"], "Caption2 = 11");
        Assert.AreEqual(11.0, (double)resources["FontSize.SectionLabel"], "SectionLabel = 11");
    }

    [TestMethod]
    public void ColorTokens_DarkMode_MatchExactSwiftValues()
    {
        App.ApplyTheme(BarAppearance.Dark);
        var resources = s_resources!;

        var accent = ((SolidColorBrush)resources["AccentBrush"]).Color;
        Assert.AreEqual(Color.FromRgb(0xE2, 0x73, 0x2A), accent, "Dark Accent = #E2732A");

        var subscription = ((SolidColorBrush)resources["SubscriptionBrush"]).Color;
        Assert.AreEqual(Color.FromRgb(0x5B, 0x63, 0xD9), subscription, "Dark Subscription = #5B63D9");

        var green = ((SolidColorBrush)resources["GreenBrush"]).Color;
        Assert.AreEqual(Color.FromRgb(0x5C, 0xBC, 0x8F), green, "Dark Green = #5CBC8F");

        var amber = ((SolidColorBrush)resources["AmberBrush"]).Color;
        Assert.AreEqual(Color.FromRgb(0xDB, 0xAB, 0x4F), amber, "Dark Amber = #DBAB4F");

        var coral = ((SolidColorBrush)resources["CoralBrush"]).Color;
        Assert.AreEqual(Color.FromRgb(0xE8, 0x75, 0x5C), coral, "Dark Coral = #E8755C");

        var red = ((SolidColorBrush)resources["RedBrush"]).Color;
        Assert.AreEqual(Color.FromRgb(0xD9, 0x56, 0x4F), red, "Dark Red = #D9564F");

        var window = ((SolidColorBrush)resources["WindowBrush"]).Color;
        Assert.AreEqual(Color.FromArgb(0xE6, 0x20, 0x21, 0x24), window, "Dark Window uses translucent Windows material fallback");

        var text = ((SolidColorBrush)resources["TextBrush"]).Color;
        Assert.AreEqual(Color.FromRgb(0xF2, 0xF2, 0xF2), text, "Dark Text = #F2F2F2");

        var muted = ((SolidColorBrush)resources["MutedBrush"]).Color;
        Assert.AreEqual(Color.FromRgb(0xA8, 0xA8, 0xAC), muted, "Dark Muted = #A8A8AC");

        var border = ((SolidColorBrush)resources["BorderBrush"]).Color;
        Assert.AreEqual(Color.FromRgb(0x40, 0x40, 0x44), border, "Dark Border = #404044");

        var card = (SolidColorBrush)resources["CardBrush"];
        Assert.AreEqual(Color.FromRgb(0xF2, 0xF2, 0xF2), card.Color);
        Assert.AreEqual(.05, card.Opacity);

        var track = (SolidColorBrush)resources["TrackBrush"];
        Assert.AreEqual(Color.FromRgb(0xF2, 0xF2, 0xF2), track.Color);
        Assert.AreEqual(.12, track.Opacity);
    }

    [TestMethod]
    public void ColorTokens_LightMode_MatchExactSwiftValues()
    {
        App.ApplyTheme(BarAppearance.Light);
        var resources = s_resources!;

        var accent = ((SolidColorBrush)resources["AccentBrush"]).Color;
        Assert.AreEqual(Color.FromRgb(0xCF, 0x5B, 0x10), accent, "Light Accent = #CF5B10");

        var subscription = ((SolidColorBrush)resources["SubscriptionBrush"]).Color;
        Assert.AreEqual(Color.FromRgb(0x46, 0x4D, 0xBE), subscription, "Light Subscription = #464DBE");

        var green = ((SolidColorBrush)resources["GreenBrush"]).Color;
        Assert.AreEqual(Color.FromRgb(0x1B, 0x94, 0x5B), green, "Light Green = #1B945B");

        var amber = ((SolidColorBrush)resources["AmberBrush"]).Color;
        Assert.AreEqual(Color.FromRgb(0xB8, 0x7D, 0x0B), amber, "Light Amber = #B87D0B");

        var coral = ((SolidColorBrush)resources["CoralBrush"]).Color;
        Assert.AreEqual(Color.FromRgb(0xD4, 0x4D, 0x28), coral, "Light Coral = #D44D28");

        var red = ((SolidColorBrush)resources["RedBrush"]).Color;
        Assert.AreEqual(Color.FromRgb(0xC6, 0x28, 0x23), red, "Light Red = #C62823");

        var window = ((SolidColorBrush)resources["WindowBrush"]).Color;
        Assert.AreEqual(Color.FromRgb(0xF5, 0xF5, 0xF7), window, "Light Window = #F5F5F7");

        var text = ((SolidColorBrush)resources["TextBrush"]).Color;
        Assert.AreEqual(Color.FromRgb(0x1D, 0x1D, 0x1F), text, "Light Text = #1D1D1F");

        var muted = ((SolidColorBrush)resources["MutedBrush"]).Color;
        Assert.AreEqual(Color.FromRgb(0x68, 0x68, 0x6C), muted, "Light Muted = #68686C");

        var border = ((SolidColorBrush)resources["BorderBrush"]).Color;
        Assert.AreEqual(Color.FromRgb(0xD7, 0xD7, 0xDB), border, "Light Border = #D7D7DB");

        var card = (SolidColorBrush)resources["CardBrush"];
        Assert.AreEqual(Color.FromRgb(0x1D, 0x1D, 0x1F), card.Color);
        Assert.AreEqual(.05, card.Opacity);

        var track = (SolidColorBrush)resources["TrackBrush"];
        Assert.AreEqual(Color.FromRgb(0x1D, 0x1D, 0x1F), track.Color);
        Assert.AreEqual(.12, track.Opacity);
    }
}
