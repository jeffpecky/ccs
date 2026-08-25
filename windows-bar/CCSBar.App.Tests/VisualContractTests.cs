using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;
using CCSBar.App;
using CCSBar.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace CCSBar.App.Tests;

using Ellipse = System.Windows.Shapes.Ellipse;

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
    static readonly string SwiftMenuPath = Path.GetFullPath(Path.Combine(ProjectRoot, "..", "macos-bar", "Sources", "CCSBarApp", "BarMenuView.swift"));
    static readonly string SwiftSettingsControllerPath = Path.GetFullPath(Path.Combine(ProjectRoot, "..", "macos-bar", "Sources", "CCSBarApp", "SettingsWindowController.swift"));
    static readonly string ControlsDir = Path.Combine(ProjectRoot, "CCSBar.App", "Controls");

    static App? s_app;
    static ResourceDictionary? s_resources;

    [ClassInitialize]
    public static void ClassInit(TestContext context)
    {
        EnsureApplication();
    }

    internal static void EnsureApplication()
    {
        if (s_resources is not null) return;
        s_app = Application.Current as App ?? new App();
        if (s_app.Resources.Count == 0) s_app.InitializeComponent();
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
            Assert.IsNotNull(((Image)window.FindName("HeaderLogo")).Source, "Header logo resource must resolve and render");
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
            var left = ((StackPanel)window.FindName("FooterPrimary")).Children.Cast<Button>().Select(ButtonLabel).ToArray();
            var right = ((StackPanel)window.FindName("FooterActions")).Children.OfType<Button>().Where(x => x.Visibility == Visibility.Visible).Select(x => x.ToolTip?.ToString()).ToArray();
            CollectionAssert.AreEqual(new[] { "Dashboard", "Icon", "Settings" }, left);
            CollectionAssert.AreEqual(new[] { "Refresh", "Quit CCS Bar (click again to confirm)" }, right);
            Assert.IsTrue(((StackPanel)window.FindName("FooterPrimary")).Children.Cast<Button>().All(b => b.Content is StackPanel panel && panel.Children[0] is TextBlock && panel.Children[1] is TextBlock));
            Assert.IsTrue(((StackPanel)window.FindName("FooterActions")).Children.OfType<Button>().All(b => b.Content is TextBlock glyph && glyph.FontFamily.Source.Contains("Segoe Fluent")));
        }
        finally { window.Detach(); window.Close(); }
    }

    static string? ButtonLabel(Button button) => button.Content is StackPanel panel
        ? panel.Children.OfType<TextBlock>().LastOrDefault()?.Text
        : button.Content?.ToString();

    [TestMethod]
    public void MainWindow_SourceComposition_MatchesSwiftHierarchyAndDimensions()
    {
        var swift = File.ReadAllText(SwiftMenuPath);
        StringAssert.Contains(swift, ".frame(width: 360)");
        StringAssert.Contains(swift, "Label(\"Dashboard\", systemImage: \"chart.bar.xaxis\")");
        StringAssert.Contains(swift, "\"Icon\",");
        StringAssert.Contains(swift, "Label(\"Settings\", systemImage: \"gearshape\")");
        StringAssert.Contains(swift, "Image(systemName: \"arrow.clockwise\")");
        StringAssert.Contains(swift, "Image(systemName: \"power\")");
        var xaml = File.ReadAllText(MainWindowXamlPath);
        Assert.IsTrue(xaml.IndexOf("x:Name=\"Header\"", StringComparison.Ordinal) < xaml.IndexOf("x:Name=\"ContentPanel\"", StringComparison.Ordinal));
        Assert.IsTrue(xaml.IndexOf("x:Name=\"ContentPanel\"", StringComparison.Ordinal) < xaml.IndexOf("x:Name=\"Footer\"", StringComparison.Ordinal));
    }

    [TestMethod]
    public void DevelopmentAssembly_UsesMacOSVersionFile()
    {
        var expected = File.ReadAllText(Path.Combine(ProjectRoot, "..", "macos-bar", "VERSION")).Trim();
        Assert.AreEqual(expected, typeof(MainWindow).Assembly.GetName().Version?.ToString(3));
        Assert.AreEqual(expected, typeof(MainWindow).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion);
        Assert.AreNotEqual("1.0.0", expected);
    }

    static MainWindow CreateMainWindow(BarViewModel vm, IBarClock? clock = null, IBarSettings? settings = null, Action? installUpdate = null)
    {
        var appSettings = settings ?? Activator.CreateInstance(typeof(MainWindow).Assembly.GetType("CCSBar.App.JsonBarSettings")!, nonPublic: true)!;
        return (MainWindow)Activator.CreateInstance(typeof(MainWindow), BindingFlags.Instance | BindingFlags.NonPublic, null, [vm, appSettings, clock, installUpdate], null)!;
    }

    const string CardTag = "subscription-card";
    const string PoolTag = "pool-card";

    [STATestMethod]
    public void MainWindow_SubscriptionSection_MatchesMacOSCardContract()
    {
        var window = CreateFixtureWindow(out _);
        try
        {
            var panel = (StackPanel)window.FindName("ContentPanel")!;
            Assert.IsNotNull(Text(panel, "SUBSCRIPTIONS"), "Section heading missing");
            Assert.AreEqual("most room: Codex 88%", Text(panel, "most room: Codex 88%")!.Text);
            Assert.AreEqual(10d, Text(panel, "Claude Code")!.FontSize, "Per-provider caption missing");
            Assert.AreEqual(10d, Text(panel, "Codex")!.FontSize, "Per-provider caption missing");

            var cards = Tagged<Border>(panel, CardTag);
            Assert.AreEqual(2, cards.Count, "One visible card per provider carousel");
            var claude = cards.First(c => Text(c, "72%") is not null);
            var codex = cards.First(c => Text(c, "88%") is not null);
            Assert.AreEqual(1d, claude.Opacity);
            Assert.AreEqual(1d, codex.Opacity);

            CollectionAssert.AreEqual(new[] { "default", "subscription", "pro" }, ChipTexts(claude));
            CollectionAssert.AreEqual(new[] { "default", "subscription", "plus" }, ChipTexts(codex));

            var fiveHour = Tagged<Grid>(claude, "five_hour").Single();
            var sevenDay = Tagged<Grid>(claude, "seven_day").Single();
            CollectionAssert.AreEqual(new[] { GridUnitType.Pixel, GridUnitType.Pixel, GridUnitType.Pixel, GridUnitType.Pixel, GridUnitType.Pixel, GridUnitType.Pixel, GridUnitType.Auto }, fiveHour.ColumnDefinitions.Select(c => c.Width.GridUnitType).ToArray());
            CollectionAssert.AreEqual(new[] { 32d, 110d, 5d, 32d, 5d, 48d }, fiveHour.ColumnDefinitions.Take(6).Select(c => c.Width.Value).ToArray());
            Assert.AreEqual(5d, Track(fiveHour).Height, "Non-binding bar is 5 DIP");
            Assert.AreEqual(7d, Track(sevenDay).Height, "Binding bar is 7 DIP");
            Assert.AreEqual(110 * 0.72, Fill(fiveHour).Width, 0.01);
            Assert.AreEqual(110 * 0.48, Fill(sevenDay).Width, 0.01);
            Assert.AreEqual(8d, Tagged<Ellipse>(claude, "health-dot").Single().Width);
            Assert.IsNotNull(Text(claude, "5h"));
            Assert.IsNotNull(Text(claude, "wk"));
            Assert.IsNotNull(Text(claude, "2h 18m"));
            Assert.IsNotNull(Text(claude, "Mon"));
            Assert.IsFalse(All<TextBlock>(claude).Any(t => t.Text.StartsWith("⚠")), "Pace warning only on at-risk binding windows");
            Assert.IsFalse(All<TextBlock>(codex).Any(t => t.Text.StartsWith("⚠")));
            Assert.IsNull(Text(claude, "as of 11:25, older session"));
            Assert.IsNotNull(Text(codex, "as of 11:25, older session"), "Stale footnote missing");
            var refresh = Named<Button>(codex, "Force refresh");
            Assert.IsNotNull(refresh, "Inline stale refresh missing");
            Assert.AreEqual("Force refresh to get the latest data", refresh!.ToolTip?.ToString());
            Assert.AreEqual("ok status", AutomationProperties.GetName(Tagged<Ellipse>(claude, "health-dot").Single()));
            Assert.AreEqual("ok status", AutomationProperties.GetName(Tagged<Ellipse>(codex, "health-dot").Single()));
        }
        finally { window.Detach(); window.Close(); }
    }

    [STATestMethod]
    public void MainWindow_ProfileCarousel_PagesWithDotsArrowsAndKeepsKeyboardHost()
    {
        var window = CreateFixtureWindow(out _);
        try
        {
            var panel = (StackPanel)window.FindName("ContentPanel")!;
            var prev = Named<Button>(panel, "Previous Claude Code profile");
            var next = Named<Button>(panel, "Next Claude Code profile");
            Assert.IsNotNull(prev);
            Assert.IsNotNull(next);
            Assert.IsFalse(prev!.IsEnabled, "Prev disabled on first page");
            Assert.IsTrue(next!.IsEnabled);
            Assert.AreEqual(2, All<Button>(panel).Count(b => AutomationProperties.GetName(b) is { } name && name.StartsWith("Show ") && name.EndsWith(" profile")), "Page dots missing");
            Assert.IsTrue(All<StackPanel>(panel).Any(s => s.Focusable), "Keyboard carousel host missing");
            Assert.IsNull(Text(panel, "⚠ ~22m"));

            Invoke(next!);
            Assert.IsNull(Text(panel, "72%"), "Default card should page away");
            Assert.IsNotNull(Text(panel, "⚠ ~22m"), "Pace warning on parked binding window");
            var ck = Tagged<Border>(panel, CardTag).Single(c => Text(c, "⚠ ~22m") is not null);
            Assert.AreEqual(0.5, ck.Opacity, "Parked card dimmed to 0.5");
            CollectionAssert.AreEqual(new[] { "ccsx", "subscription" }, ChipTexts(ck));
            Assert.IsTrue(Named<Button>(panel, "Previous Claude Code profile")!.IsEnabled);
            Assert.IsFalse(Named<Button>(panel, "Next Claude Code profile")!.IsEnabled);

            Invoke(Named<Button>(panel, "Show Claude Code profile")!);
            Assert.IsNotNull(Text(panel, "72%"), "Dot click returns to default profile");
        }
        finally { window.Detach(); window.Close(); }
    }

    [STATestMethod]
    public void MainWindow_PoolRows_MatchMacOSRowContract()
    {
        var window = CreateFixtureWindow(out _);
        try
        {
            var panel = (StackPanel)window.FindName("ContentPanel")!;
            Assert.IsNotNull(Text(panel, "POOL ACCOUNTS"));
            var pools = Tagged<Border>(panel, PoolTag);
            Assert.AreEqual(2, pools.Count);
            var gemini = pools.First(p => Text(p, "Gemini pool") is not null);
            var kiro = pools.First(p => Text(p, "Kiro") is not null);
            CollectionAssert.AreEqual(new[] { "default", "cliproxy" }, ChipTexts(gemini));
            CollectionAssert.AreEqual(new[] { "paused", "kiro", "free" }, ChipTexts(kiro));

            var gauge = Tagged<Grid>(gemini, "pool-gauge").Single();
            Assert.AreEqual(54d, gauge.Width);
            Assert.AreEqual(6d, gauge.Height);
            Assert.AreEqual("Quota remaining", AutomationProperties.GetName(gauge));
            Assert.AreEqual("80%", AutomationProperties.GetHelpText(gauge));
            Assert.IsNotNull(Text(gemini, "80%"));
            Assert.IsNotNull(Text(gemini, "resets in 3h 0m"));
            Assert.IsNotNull(Text(kiro, "no quota"));
            Assert.IsNotNull(Text(gemini, "$0.00"), "Real zero cost renders as $0.00");
            Assert.IsNotNull(Text(kiro, "no data"));
            Assert.IsNotNull(Text(gemini, "Last active today"));
            Assert.IsNotNull(Named<Button>(gemini, "Pause Gemini pool"));
            Assert.IsNotNull(Named<Button>(kiro, "Resume Kiro"));

            var geminiMenu = Named<Button>(gemini, "Actions for Gemini pool")!.ContextMenu!;
            CollectionAssert.AreEqual(new[] { "Set as default", "Solo (pause others)", "Clear tier lock" }, MenuHeaders(geminiMenu));
            var kiroMenu = Named<Button>(kiro, "Actions for Kiro")!.ContextMenu!;
            CollectionAssert.AreEqual(new[] { "Set as default", "Solo (pause others)", "Lock to free", "Clear tier lock" }, MenuHeaders(kiroMenu));
        }
        finally { window.Detach(); window.Close(); }
    }

    [STATestMethod]
    public void MainWindow_ConditionalSectionNaming_MatchesMacOS()
    {
        var both = CreateFixtureWindow(out _);
        try
        {
            var panel = (StackPanel)both.FindName("ContentPanel")!;
            Assert.IsNotNull(Text(panel, "SUBSCRIPTIONS"));
            Assert.IsNotNull(Text(panel, "POOL ACCOUNTS"));
        }
        finally { both.Detach(); both.Close(); }

        var poolOnly = CreateFixtureWindow(out _, ScreenshotRows()[3..]);
        try
        {
            var panel = (StackPanel)poolOnly.FindName("ContentPanel")!;
            Assert.IsNotNull(Text(panel, "ACCOUNTS"), "CLIProxy-only setup keeps the single Accounts header");
            Assert.IsNull(Text(panel, "SUBSCRIPTIONS"));
            Assert.IsNull(Text(panel, "POOL ACCOUNTS"));
            Assert.IsNull(Text(panel, "most room: Codex 88%"));
        }
        finally { poolOnly.Detach(); poolOnly.Close(); }

        var subsOnly = CreateFixtureWindow(out _, [ScreenshotRows()[0], ScreenshotRows()[2]]);
        try
        {
            var panel = (StackPanel)subsOnly.FindName("ContentPanel")!;
            Assert.IsNotNull(Text(panel, "SUBSCRIPTIONS"));
            Assert.IsNull(Text(panel, "POOL ACCOUNTS"));
        }
        finally { subsOnly.Detach(); subsOnly.Close(); }

        var empty = CreateFixtureWindow(out _, []);
        try
        {
            var state = (StackPanel)empty.FindName("EmptyState")!;
            Assert.AreEqual("ACCOUNTS", ((TextBlock)state.Children[0]).Text);
            Assert.AreEqual("No accounts configured", ((TextBlock)state.Children[1]).Text);
        }
        finally { empty.Detach(); empty.Close(); }
    }

    internal static MainWindow CreateFixtureWindow(out BarViewModel vm, BarSummaryRow[]? rows = null)
    {
        var clock = new FixtureClock();
        var settings = new TestSettings();
        vm = new BarViewModel(new FixtureConnector(new FixtureClient(rows ?? ScreenshotRows())), settings, clock);
        var window = CreateMainWindow(vm, clock, settings);
        vm.ReconnectAndLoadAsync(false).GetAwaiter().GetResult();
        window.Render();
        return window;
    }

    static readonly DateTimeOffset FixtureNow = DateTimeOffset.Parse("2026-08-22T12:00:00+00:00");

    static QuotaWindowDetail Win(string key, double remaining, int minutes, string resetAt) => new(key, key, 100 - remaining, remaining, resetAt, minutes);

    static BarSummaryRow SubscriptionRow(string account, string provider, string profile, string? surface, bool isDefault, bool paused, string? tier, QuotaWindowDetail[] windows, string? staleAsOf = null, string? lastActivityAt = null, double? todayCost = null) =>
        new(account, provider, null, tier, paused, windows.Min(x => x.RemainingPercent), "ok", null, isDefault, lastActivityAt, todayCost, "ok", false, null, false, surface, profile, true, windows, staleAsOf);

    static BarSummaryRow PoolRow(string account, string provider, string display, bool isDefault, bool paused, string? tier, double? quota, string status, string? nextReset, string? lastActivityAt, double? todayCost, string health) =>
        new(account, provider, display, tier, paused, quota, status, nextReset, isDefault, lastActivityAt, todayCost, health, false, null, false, null, null, null, null, null);

    internal static BarSummaryRow[] ScreenshotRows() =>
    [
        SubscriptionRow("claude-code", "claude-code", "default", null, true, false, "pro",
            [Win("five_hour", 72, 300, "2026-08-22T14:18:00+00:00"), Win("seven_day", 48, 10080, "2026-08-24T12:00:00+00:00")],
            lastActivityAt: "2026-08-22T11:48:00+00:00", todayCost: 2.26),
        SubscriptionRow("ck", "claude-code", "ck", "ccsx", false, true, null,
            [Win("five_hour", 8, 300, "2026-08-22T12:40:00+00:00"), Win("seven_day", 60, 10080, "2026-08-27T12:00:00+00:00")]),
        SubscriptionRow("codex", "codex", "default", null, true, false, "plus",
            [Win("five_hour", 88, 300, "2026-08-22T16:02:00+00:00"), Win("seven_day", 91, 10080, "2026-08-25T12:00:00+00:00")],
            staleAsOf: "2026-08-22T11:25:00+00:00", lastActivityAt: "2026-08-22T11:26:00+00:00", todayCost: 0),
        PoolRow("gemini-pool", "cliproxy", "Gemini pool", true, false, null, 80, "ok", "2026-08-22T15:00:00+00:00", "2026-08-22T11:00:00+00:00", 0, "ok"),
        PoolRow("kiro-1", "kiro", "Kiro", false, true, "free", null, "unsupported", null, null, null, "warning"),
    ];

    internal static MainWindow CreateVisualFixture(VisualFixture fixture)
    {
        if (fixture is VisualFixture.PopulatedLight or VisualFixture.PopulatedDark)
            return CreateAnalyticsFixtureWindow(out _, ScreenshotAnalytics());
        var clock = new FixtureClock();
        var settings = new TestSettings();
        BarViewModel vm;

        if (fixture == VisualFixture.Offline)
        {
            vm = new BarViewModel(new TestConnector(), settings, clock);
            vm.ReconnectAndLoadAsync(false).GetAwaiter().GetResult();
        }
        else
        {
            vm = new BarViewModel(
                new FixtureConnector(new FixtureClient(fixture == VisualFixture.Alerts ? ExtendedAlertRows() : ScreenshotRows(), ScreenshotAnalytics())), settings, clock,
                _ => Task.FromResult<string?>("9.9.9"), currentVersion: "0.0.0");
            vm.ReconnectAndLoadAsync(false).GetAwaiter().GetResult();
            if (fixture == VisualFixture.Starting)
                typeof(BarViewModel).GetProperty(nameof(BarViewModel.IsStarting))!.SetValue(vm, true);
            if (fixture == VisualFixture.Update)
                vm.CheckForUpdatesAsync().GetAwaiter().GetResult();
        }

        var window = CreateMainWindow(vm, clock, settings);
        window.Render();
        return window;
    }

    static IEnumerable<DependencyObject> Descendants(DependencyObject root)
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++)
        {
            var child = VisualTreeHelper.GetChild(root, i);
            yield return child;
            foreach (var nested in Descendants(child)) yield return nested;
        }
    }

    static IReadOnlyList<T> All<T>(DependencyObject root) => Descendants(root).OfType<T>().ToArray();
    static IEnumerable<T> DescendantsOf<T>(DependencyObject root) where T : DependencyObject => Descendants(root).OfType<T>();
    static IReadOnlyList<T> Tagged<T>(DependencyObject root, object tag) where T : FrameworkElement => Descendants(root).OfType<T>().Where(x => Equals(x.Tag, tag)).ToArray();
    static T? Named<T>(DependencyObject root, string name) where T : DependencyObject => Descendants(root).OfType<T>().FirstOrDefault(x => AutomationProperties.GetName(x) == name);
    static TextBlock? Text(DependencyObject root, string text) => Descendants(root).OfType<TextBlock>().FirstOrDefault(t => t.Text == text);
    static TextBlock? Text(DependencyObject root, Func<string, bool> match) => Descendants(root).OfType<TextBlock>().FirstOrDefault(t => match(t.Text));
    static IReadOnlyList<string> LogicalTexts(DependencyObject root)
    {
        var texts = new List<string>();
        void Walk(DependencyObject node)
        {
            if (node is TextBlock block) texts.Add(block.Text);
            foreach (var child in LogicalTreeHelper.GetChildren(node)) if (child is DependencyObject dependency) Walk(dependency);
        }
        Walk(root);
        return texts;
    }
    static string[] ChipTexts(DependencyObject root) => [.. Descendants(root)
        .OfType<Border>()
        .Where(b => b.Child is TextBlock && b.CornerRadius.TopLeft == 100)
        .Select(b => ((TextBlock)b.Child!).Text)];
    static void Invoke(Button button) => button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    static Border Track(DependencyObject quotaRow) => Tagged<Border>(quotaRow, "quota-track").Single();
    static Border Fill(DependencyObject quotaRow) => Tagged<Border>(quotaRow, "quota-fill").Single();
    static string[] MenuHeaders(ContextMenu menu) => [.. menu.Items.OfType<MenuItem>().Select(i => i.Header!.ToString()!)];

    sealed class FixtureClock : IBarClock { public DateTimeOffset Now => FixtureNow; }
    sealed class FixtureConnector(IBarDataClient client) : IBarConnector { public Task<IBarDataClient?> ConnectAsync(bool launch, CancellationToken cancellationToken) => Task.FromResult<IBarDataClient?>(client); }
    sealed class FixtureClient(IReadOnlyList<BarSummaryRow> rows, BarAnalytics? analytics = null) : IBarDataClient
    {
        public Task<IReadOnlyList<BarSummaryRow>> SummaryAsync(bool force, CancellationToken ct) => Task.FromResult(rows);
        public Task<BarAnalytics?> AnalyticsAsync(CancellationToken ct) => Task.FromResult(analytics);
        public Task PauseAsync(BarSummaryRow row, CancellationToken ct) => Task.CompletedTask;
        public Task ResumeAsync(BarSummaryRow row, CancellationToken ct) => Task.CompletedTask;
        public Task SoloAsync(BarSummaryRow row, CancellationToken ct) => Task.CompletedTask;
        public Task SetDefaultAsync(BarSummaryRow row, CancellationToken ct) => Task.CompletedTask;
        public Task TierLockAsync(BarSummaryRow row, string? tier, CancellationToken ct) => Task.CompletedTask;
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

    // ---- Task 8: analytics, alerts, and update UI contracts ----

    [TestMethod]
    public void SpendAxis_Formatters_MatchMacOSLabels()
    {
        Assert.AreEqual("12a", BarCardFormatting.HourShort("2026-08-22 00:00"));
        Assert.AreEqual("6a", BarCardFormatting.HourShort("2026-08-22 06:00"));
        Assert.AreEqual("12p", BarCardFormatting.HourShort("2026-08-22 12:00"));
        Assert.AreEqual("6p", BarCardFormatting.HourShort("2026-08-22 18:00"));
        Assert.AreEqual("11p", BarCardFormatting.HourShort("2026-08-22 23:00"));
        Assert.IsNull(BarCardFormatting.HourShort("garbage"));
        Assert.IsNull(BarCardFormatting.HourShort("2026-08-22T11:00"));
        Assert.AreEqual("Sun", BarCardFormatting.WeekdayShort("2026-08-16"));
        Assert.AreEqual("Sat", BarCardFormatting.WeekdayShort("2026-08-22"));
        Assert.IsNull(BarCardFormatting.WeekdayShort("22-08-2026"));
        Assert.AreEqual("Jul 24", BarCardFormatting.MonthDayShort("2026-07-24"));
        Assert.IsNull(BarCardFormatting.MonthDayShort(null));
    }

    [TestMethod]
    public void SpendAxis_Ticks_MatchMacOSPlacement()
    {
        var analytics = ScreenshotAnalytics();

        var today = SpendAxis.Ticks(SpendPeriod.Today, analytics.ByHour, analytics.ByDay);
        CollectionAssert.AreEqual(new[] { "12a", "6a", "12p", "6p", "11p" }, today.Select(t => t.Label).ToArray());
        double[] todayFractions = [0.5 / 24, 6.5 / 24, 12.5 / 24, 18.5 / 24, 23.5 / 24];
        for (var i = 0; i < todayFractions.Length; i++) Assert.AreEqual(todayFractions[i], today[i].Fraction, 1e-9);

        var week = SpendAxis.Ticks(SpendPeriod.Last7d, analytics.ByHour, analytics.ByDay);
        CollectionAssert.AreEqual(new[] { "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat" }, week.Select(t => t.Label).ToArray());
        for (var i = 0; i < 7; i++) Assert.AreEqual((i + 0.5) / 7, week[i].Fraction, 1e-9);

        var month = SpendAxis.Ticks(SpendPeriod.Last30d, analytics.ByHour, analytics.ByDay);
        CollectionAssert.AreEqual(new[] { "Jul 24", "Jul 31", "Aug 7", "Aug 14", "Aug 22" }, month.Select(t => t.Label).ToArray());
        Assert.AreEqual(5, month.Count);

        Assert.AreEqual(0, SpendAxis.Ticks(SpendPeriod.Last30d, analytics.ByHour, analytics.ByDay.Take(1).ToArray()).Count);
        Assert.AreEqual(0, SpendAxis.Ticks(SpendPeriod.Today, [], analytics.ByDay).Count);
    }

    [TestMethod]
    public void Sparkline_Geometry_MatchesSwiftBarsContract()
    {
        var rects = Sparkline.BarGeometry([0, 1, 2], 100, 56);
        Assert.AreEqual(3, rects.Count);
        var barWidth = (100 - 2 * Sparkline.BarGap) / 3;
        for (var i = 0; i < 3; i++) Assert.AreEqual(i * (barWidth + Sparkline.BarGap), rects[i].X, 1e-9);
        CollectionAssert.AreEqual(new[] { Sparkline.MinBarHeight, 28d, 56d }, rects.Select(r => r.Height).ToArray());
        CollectionAssert.AreEqual(new[] { true, false, false }, rects.Select(r => r.Placeholder).ToArray());
        Assert.AreEqual(2, Sparkline.Corner);
        Assert.AreEqual(3, Sparkline.BarGap);
    }

    [TestMethod]
    public void Sparkline_LineAndBaseline_MatchSwiftContract()
    {
        var points = Sparkline.LineGeometry([0, 3], 90, 56);
        Assert.AreEqual(0, points[0].X, 1e-9);
        Assert.AreEqual(56, points[0].Y, 1e-9);
        Assert.AreEqual(90, points[1].X, 1e-9);
        Assert.AreEqual(0, points[1].Y, 1e-9);
        Assert.IsTrue(Sparkline.IsBaseline([]));
        Assert.IsTrue(Sparkline.IsBaseline([0, 0]));
        Assert.IsTrue(Sparkline.IsBaseline([4]));
        Assert.IsFalse(Sparkline.IsBaseline([0, 1]));
        Assert.AreEqual(1.5, Sparkline.StrokeWidth);
        Assert.AreEqual(0.15, Sparkline.AreaFillOpacity);
        Assert.AreEqual(0.20, Sparkline.BaselineOpacity);
    }

    [TestMethod]
    public void Alerts_GroupingDedupesAndRanksBySeverity()
    {
        var groups = AlertDisplay.Group(
        [
            new BarNotification("a", "Account paused", "Mirror is paused", BarAlertKind.AccountCooldownOrPaused),
            new BarNotification("b", "Quota low", "x has 15% remaining", BarAlertKind.QuotaRemainingBelow),
            new BarNotification("c", "Re-authentication needed", "m needs sign-in", BarAlertKind.ReauthNeeded),
            new BarNotification("d", "Account paused", "Mirror is paused", BarAlertKind.AccountCooldownOrPaused),
            new BarNotification("e", "Daily spend cap", "over cap", BarAlertKind.DailySpendAbove),
            new BarNotification("f", "Account paused", "other is paused", BarAlertKind.AccountCooldownOrPaused),
        ]);
        CollectionAssert.AreEqual(
            new[]
            {
                BarAlertKind.ReauthNeeded, BarAlertKind.DailySpendAbove, BarAlertKind.QuotaRemainingBelow,
                BarAlertKind.AccountCooldownOrPaused, BarAlertKind.AccountCooldownOrPaused,
            },
            groups.Select(g => g.Alert.Kind).ToArray());
        Assert.AreEqual(2, groups.Single(g => g.Alert.Body == "Mirror is paused").Count);
    }

    [TestMethod]
    public void TextFit_MiddleEllipsis_TrimsCenterNotTail()
    {
        Assert.AreEqual("abcdefghij", TextFit.MiddleEllipsis("abcdefghij", 10));
        Assert.AreEqual("ab…ij", TextFit.MiddleEllipsis("abcdefghij", 5));
        Assert.AreEqual("…x", TextFit.MiddleEllipsis("abcdefx", 2));
    }

    [STATestMethod]
    public void MainWindow_SpendStrip_MatchesMacOSContract()
    {
        var window = CreateAnalyticsFixtureWindow(out var vm, ScreenshotAnalytics());
        try
        {
            NormalizeSpendUi(vm, window);
            var panel = (StackPanel)window.FindName("ContentPanel")!;
            Assert.IsNotNull(Text(panel, "SPEND"));
            Assert.IsNotNull(Text(panel, "7d $18.40"), "Caption must sit above the chart and sum the charted series");
            var chart = Tagged<Sparkline>(panel, "spend-chart").Single();
            Assert.AreEqual(56d, chart.Height);
            Assert.AreEqual(SpendChartStyle.Bars, chart.ChartStyle);
            Assert.AreEqual(7, chart.Values.Length);
            var axis = Tagged<Canvas>(panel, "spend-axis").Single();
            Assert.AreEqual(12d, axis.Height);
            var labels = axis.Children.OfType<TextBlock>().ToArray();
            CollectionAssert.AreEqual(new[] { "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat" }, labels.Select(l => l.Text).ToArray());
            Assert.IsTrue(labels.All(l => l.FontSize == 9 && Equals(l.FontFamily, s_resources!["FontFamily.Mono"])), "Axis labels are 9pt monospaced");
            var lefts = labels.Select(Canvas.GetLeft).ToArray();
            Assert.IsTrue(lefts.Zip(lefts.Skip(1), (a, b) => a < b).All(ok => ok), "Weekday labels progress left to right");

            var today = Named<Button>(panel, "Spend period Today")!;
            var seven = Named<Button>(panel, "Spend period 7d")!;
            var thirty = Named<Button>(panel, "Spend period 30d")!;
            Assert.AreEqual(FontWeights.SemiBold, seven.FontWeight);
            Assert.AreEqual(FontWeights.Normal, today.FontWeight);
            Assert.AreEqual(((SolidColorBrush)s_resources!["AccentBrush"]).Color, ((SolidColorBrush)seven.Foreground).Color);
            Assert.AreNotEqual(((SolidColorBrush)s_resources!["AccentBrush"]).Color, ((SolidColorBrush)today.Foreground).Color);
            var toggle = Named<Button>(panel, "Switch spend chart style")!;
            Assert.AreEqual("Spend graph: switch to line", toggle.ToolTip?.ToString());

            Invoke(thirty);
            NormalizeSpendUi(vm, window, keepSelection: true);
            panel = (StackPanel)window.FindName("ContentPanel")!;
            Assert.IsNotNull(Text(panel, "30d $61.20"));
            Assert.AreEqual(SpendPeriod.Last30d, vm.Ui.SpendPeriod);
            Assert.AreEqual(5, Tagged<Canvas>(panel, "spend-axis").Single().Children.OfType<TextBlock>().Count());

            Invoke(Named<Button>(panel, "Spend period Today")!);
            NormalizeSpendUi(vm, window, keepSelection: true);
            panel = (StackPanel)window.FindName("ContentPanel")!;
            Assert.IsNotNull(Text(panel, "today $11.85"), "Today caption sums hourly series");
            Assert.IsNull(Text(panel, "$9.99"), "Caption must not fall back to the daily aggregate when hours exist");
            var hourLabels = Tagged<Canvas>(panel, "spend-axis").Single().Children.OfType<TextBlock>().Select(l => l.Text).ToArray();
            CollectionAssert.AreEqual(new[] { "12a", "6a", "12p", "6p", "11p" }, hourLabels);

            Invoke(Named<Button>(panel, "Switch spend chart style")!);
            NormalizeSpendUi(vm, window, keepSelection: true);
            panel = (StackPanel)window.FindName("ContentPanel")!;
            Assert.AreEqual(SpendChartStyle.Line, Tagged<Sparkline>(panel, "spend-chart").Single().ChartStyle);
            Assert.AreEqual(SpendChartStyle.Line, vm.Ui.ChartStyle);
            Assert.AreEqual("Spend graph: switch to bars", Named<Button>(panel, "Switch spend chart style")!.ToolTip?.ToString());
        }
        finally { window.Detach(); window.Close(); }
    }

    [STATestMethod]
    public void MainWindow_SpendIdle_ShowsHonestCopyAndHidesControls()
    {
        var window = CreateAnalyticsFixtureWindow(out _, IdleAnalytics());
        try
        {
            var panel = (StackPanel)window.FindName("ContentPanel")!;
            Assert.IsNotNull(Text(panel, "No usage in 12 days · last active aug 10"), "Honest idle line replaces dead cells");
            Assert.IsNull(Named<Button>(panel, "Spend period Today"), "Period selector hidden without recent data");
            Assert.IsNull(Named<Button>(panel, "Spend period 30d"));
            Assert.IsNull(Named<Button>(panel, "Switch spend chart style"), "Toggle hidden without recent data");
            Assert.AreEqual(0, Tagged<Sparkline>(panel, "spend-chart").Count());
            Assert.AreEqual(0, Tagged<Canvas>(panel, "spend-axis").Count());
        }
        finally { window.Detach(); window.Close(); }
    }

    [STATestMethod]
    public void MainWindow_SpendAllZero_SuppressesToggleKeepsFrame()
    {
        var window = CreateAnalyticsFixtureWindow(out var vm, EmptyRecentAnalytics());
        try
        {
            NormalizeSpendUi(vm, window);
            var panel = (StackPanel)window.FindName("ContentPanel")!;
            Assert.IsNotNull(Text(panel, "7d $0.00"));
            Assert.IsNull(Named<Button>(panel, "Switch spend chart style"), "Toggle hidden while the charted series is all zero");
            Assert.IsNotNull(Named<Button>(panel, "Spend period 7d"), "Selector stays while recent data exists");
            Assert.AreEqual(1, Tagged<Sparkline>(panel, "spend-chart").Count, "Chart frame stays visible");
        }
        finally { window.Detach(); window.Close(); }
    }

    [STATestMethod]
    public void MainWindow_Breakdown_MatchesMacOSRowContract()
    {
        var window = CreateAnalyticsFixtureWindow(out _, ScreenshotAnalytics());
        try
        {
            Layout(window);
            var panel = (StackPanel)window.FindName("ContentPanel")!;
            Assert.IsNotNull(Text(panel, "BY SURFACE"));
            Assert.IsNotNull(Text(panel, "TOP MODELS · 30D"));

            var rows = Tagged<Grid>(panel, "breakdown-row").ToArray();
            Assert.AreEqual(9, rows.Length, "Max 5 surfaces + max 4 models");
            foreach (var row in rows)
            {
                Assert.AreEqual(26d, row.Height);
                var fill = Tagged<Border>(row, "breakdown-fill").Single();
                Assert.AreEqual(new CornerRadius(5), fill.CornerRadius);
                Assert.AreEqual(0.16, fill.Opacity, 1e-6);
            }

            var surfaceRow = rows.First(r => Text(r, "claude-code") is not null);
            Assert.AreEqual(((SolidColorBrush)s_resources!["SubscriptionBrush"]).Color, ((SolidColorBrush)Tagged<Border>(surfaceRow, "breakdown-fill").Single().Background).Color, "Surface rows tint with subscription color");
            Assert.IsNotNull(Text(surfaceRow, "120"), "Request count shown for surfaces");
            Assert.IsNotNull(Text(surfaceRow, "$20.40"));
            var cursorRow = rows.First(r => Text(r, "cursor") is not null);
            var cursorFill = Tagged<Border>(cursorRow, "breakdown-fill").Single();
            Assert.AreEqual(Math.Max(8, cursorRow.ActualWidth * (0.80 / 20.40)), cursorFill.Width, 0.01, "Proportional fill with 8 DIP floor");
            Assert.AreEqual(surfaceRow.ActualWidth, Tagged<Border>(surfaceRow, "breakdown-fill").Single().Width, 0.01, "Peak row spans full width");

            var modelRow = rows.First(r => Text(r, "$12.40") is not null);
            Assert.AreEqual(((SolidColorBrush)s_resources!["AccentBrush"]).Color, ((SolidColorBrush)Tagged<Border>(modelRow, "breakdown-fill").Single().Background).Color, "Model rows tint with accent color");
            var trimmed = Text(modelRow, t => t.StartsWith("claude-opus-4-1"))!;
            Assert.IsTrue(trimmed.Text.Contains('…'), "Long model names truncate");
            Assert.IsTrue(trimmed.Text.IndexOf('…') < trimmed.Text.Length - 1, "Truncation is middle, not tail");
            Assert.IsTrue(trimmed.Text.EndsWith("suffix"), "Middle truncation keeps the tail of the name");
            Assert.IsNotNull(rows.SelectMany(DescendantsOf<TextBlock>).FirstOrDefault(t => t.Text == "gpt-5-codex"), "Short model names stay intact");
            var money = DescendantsOf<TextBlock>(modelRow).Single(t => t.Text == "$12.40");
            Assert.AreEqual(s_resources["FontFamily.Mono"], money.FontFamily, "Costs render monospaced");
        }
        finally { window.Detach(); window.Close(); }
    }

    [STATestMethod]
    public void MainWindow_Alerts_GroupDedupeRankCollapseAndTint()
    {
        var window = CreateFixtureWindow(out var vm, ExtendedAlertRows());
        try
        {
            vm.Ui = vm.Ui with { AlertsExpanded = false };
            window.Render();
            var panel = (StackPanel)window.FindName("ContentPanel")!;
            Assert.IsNotNull(Text(panel, "ALERTS"));
            var badge = Tagged<Border>(panel, "alert-count-badge").Single();
            Assert.AreEqual("6", ((TextBlock)badge.Child!).Text, "Badge shows grouped total");

            var collapsed = Tagged<Border>(panel, "alert-row").ToArray();
            Assert.AreEqual(3, collapsed.Length, "Only the most-severe three render collapsed");
            var accent = ((SolidColorBrush)s_resources!["AccentBrush"]).Color;
            var muted = ((SolidColorBrush)s_resources!["MutedBrush"]).Color;
            Assert.AreEqual(Color.FromArgb(20, accent.R, accent.G, accent.B), ((SolidColorBrush)collapsed[0].Background).Color, "Quota rows tint accent at 8%");
            Assert.AreEqual("claude-code has 8% remaining", DescendantsOf<TextBlock>(collapsed[0]).First(t => t.Tag as string != "alert-icon").Text);
            Assert.AreEqual(Color.FromArgb(20, muted.R, muted.G, muted.B), ((SolidColorBrush)collapsed[2].Background).Color, "Paused rows tint muted at 8%");
            Assert.IsTrue(collapsed.All(r => DescendantsOf<TextBlock>(r).Any(t => (t.Tag as string) == "alert-icon")), "Every row carries an icon");

            var more = Named<Button>(panel, "Show all alerts")!;
            StringAssert.Contains(LogicalTexts(more).First(t => t.Contains("more")), "3 more");
            Invoke(more);
            vm.Ui = vm.Ui with { AlertsExpanded = true };
            window.Render();
            panel = (StackPanel)window.FindName("ContentPanel")!;
            Assert.AreEqual(6, Tagged<Border>(panel, "alert-row").Count(), "Expand reveals every group");
            Assert.AreEqual(1, Tagged<Border>(panel, "alert-row").Count(r => DescendantsOf<TextBlock>(r).Any(t => t.Text == "×2")), "Duplicate conditions merge with ×2");
            Assert.IsNotNull(Text(panel, "Mirror is paused"));
            Assert.IsNotNull(Named<Button>(panel, "Show fewer alerts"));
            Assert.IsTrue(vm.Ui.AlertsExpanded);
        }
        finally { window.Detach(); window.Close(); }
    }

    [STATestMethod]
    public async Task MainWindow_UpdateBanner_MatchesMacOSStates()
    {
        var clock = new FixtureClock();
        var settings = new TestSettings();
        var vm = new BarViewModel(
            new FixtureConnector(new FixtureClient(ScreenshotRows(), ScreenshotAnalytics())), settings, clock,
            _ => Task.FromResult<string?>("9.9.9"), currentVersion: "0.0.0");
        await vm.ReconnectAndLoadAsync(false);
        await vm.CheckForUpdatesAsync();
        var installed = 0;
        var failNext = false;
        var window = CreateMainWindow(vm, clock, settings, () => { installed++; if (failNext) throw new InvalidOperationException("boom"); });
        try
        {
            window.Render();
            var panel = (StackPanel)window.FindName("ContentPanel")!;
            Assert.IsNotNull(Text(panel, "UPDATE"));
            Assert.IsNotNull(Text(panel, "Update available"));
            Assert.IsNotNull(Text(panel, "CCS Bar 9.9.9"), "Version label present");
            var card = Tagged<Border>(panel, "update-banner").Single();
            var accent = ((SolidColorBrush)s_resources!["AccentBrush"]).Color;
            Assert.AreEqual(Color.FromArgb(26, accent.R, accent.G, accent.B), ((SolidColorBrush)card.Background).Color, "Banner tinted accent at 10%");
            var now = Named<Button>(panel, "Install CCS Bar update")!;
            StringAssert.Contains(now.Content!.ToString()!, "Update Now");

            Invoke(now);
            Assert.AreEqual(1, installed);
            Assert.IsTrue(vm.IsInstallingUpdate);
            panel = (StackPanel)window.FindName("ContentPanel")!;
            Assert.IsNotNull(Text(panel, "Updating..."), "Progress state replaces the button");
            Assert.IsTrue(Tagged<ProgressBar>(panel, "update-progress").Single().IsIndeterminate);
            Assert.IsNull(Named<Button>(panel, "Install CCS Bar update"));

            vm.IsInstallingUpdate = false;
            window.Render();
            panel = (StackPanel)window.FindName("ContentPanel")!;
            Assert.IsNotNull(Named<Button>(panel, "Install CCS Bar update"), "Button restores after install hands off");

            failNext = true;
            Invoke(Named<Button>(panel, "Install CCS Bar update")!);
            Assert.AreEqual(2, installed);
            Assert.IsFalse(vm.IsInstallingUpdate);
            panel = (StackPanel)window.FindName("ContentPanel")!;
            Assert.AreEqual("boom", Tagged<TextBlock>(panel, "update-error").Single().Text, "Install failures surface inline");
            Assert.IsNotNull(Named<Button>(panel, "Install CCS Bar update"));
        }
        finally { window.Detach(); window.Close(); }
    }

    static void NormalizeSpendUi(BarViewModel? vm = null, MainWindow? window = null, bool keepSelection = false)
    {
        if (vm is null) return;
        var period = keepSelection ? vm.Ui.SpendPeriod : SpendPeriod.Last7d;
        vm.Ui = vm.Ui with { SpendPeriod = period, ChartStyle = vm.Ui.ChartStyle };
        if (window is null) return;
        window.Render();
        Layout(window);
    }

    /// <summary>Unshown windows are Collapsed and fail to measure; lay out the content subtree instead.</summary>
    static void Layout(MainWindow window)
    {
        var content = (UIElement)window.Content;
        content.Measure(new Size(360, 900));
        content.Arrange(new Rect(0, 0, 360, content.DesiredSize.Height));
        content.UpdateLayout();
    }

    internal static BarAnalytics ScreenshotAnalytics()
    {
        double[] last7 = [2.00, 2.50, 3.00, 0.00, 4.20, 3.50, 3.20];
        var byDay = Enumerable.Range(0, 30).Select(i =>
        {
            var cost = i >= 23 ? last7[i - 23] : i % 4 == 0 ? 0 : Math.Round(0.80 + 0.10 * i, 2);
            return new BarAnalyticsDay(DateTimeOffset.Parse("2026-07-24T00:00:00+00:00").AddDays(i).ToString("yyyy-MM-dd"), cost, (int)(cost * 10));
        }).ToArray();
        double[] hourCosts = [0, 0, 0.20, 0, 0.35, 0, 0.60, 0.90, 1.20, 0.75, 1.10, 0.85, 0.40, 0.95, 0, 0.55, 1.05, 0.65, 0, 0.50, 0.80, 0.45, 0.30, 0.25];
        var byHour = hourCosts.Select((c, h) => new BarAnalyticsHour($"2026-08-22 {h:00}:00", c, h)).ToArray();
        return new BarAnalytics
        {
            Today = new(9.99, 999),
            Last7d = new(18.40, 210),
            Last30d = new(61.20, 900),
            MonthToDate = new(40.00, 600),
            AllTime = new(500.00, 4000),
            ByDay = byDay,
            ByHour = byHour,
            TopModels =
            [
                new BarAnalyticsModel("claude-opus-4-1-20250805-thinking-ultra-preview-extended-long-suffix", 12.40, 40),
                new BarAnalyticsModel("claude-sonnet-4-20250514", 8.10, 33),
                new BarAnalyticsModel("gemini-2.5-pro", 4.20, 21),
                new BarAnalyticsModel("gpt-5-codex", 2.80, 12),
                new BarAnalyticsModel("deepseek-chat-v3", 0.90, 6),
            ],
            TopModelsWindow = "30d",
            BySurface =
            [
                new BarAnalyticsSurface("claude-code", "claude-code", 20.40, 120),
                new BarAnalyticsSurface("codex", "codex", 9.50, 60),
                new BarAnalyticsSurface("kiro", "kiro", 3.25, 18),
                new BarAnalyticsSurface("opencode", "opencode", 1.75, 9),
                new BarAnalyticsSurface("cursor", "cursor", 0.80, 5),
                new BarAnalyticsSurface("warp", "warp", 0.20, 2),
            ],
            LastActivityAt = "2026-08-22T11:48:00+00:00",
            DaysSinceLastActivity = null,
            HasRecentData = true,
            GeneratedAt = "2026-08-22T12:00:00+00:00",
        };
    }

    internal static BarAnalytics IdleAnalytics() => new()
    {
        Today = new(0, 0), Last7d = new(0, 0), Last30d = new(0, 0), MonthToDate = new(0, 0), AllTime = new(0, 0),
        ByDay = Enumerable.Range(0, 30).Select(i => new BarAnalyticsDay(DateTimeOffset.Parse("2026-07-24T00:00:00+00:00").AddDays(i).ToString("yyyy-MM-dd"), 0, 0)).ToArray(),
        ByHour = [],
        TopModels = [],
        TopModelsWindow = "all-time",
        BySurface = [],
        LastActivityAt = "2026-08-10T09:00:00+00:00",
        DaysSinceLastActivity = 12,
        HasRecentData = false,
        GeneratedAt = "2026-08-22T12:00:00+00:00",
    };

    internal static BarAnalytics EmptyRecentAnalytics() => IdleAnalytics() with { HasRecentData = true };

    internal static BarSummaryRow[] ExtendedAlertRows() =>
    [
        .. ScreenshotRows(),
        PoolRow("x-pool", "cliproxy", "X pool", false, false, null, 15, "ok", "2026-08-22T16:00:00+00:00", "2026-08-22T10:00:00+00:00", 0, "ok"),
        PoolRow("mirror-a", "cliproxy", "Mirror", false, true, null, null, "unsupported", null, null, null, "ok"),
        PoolRow("mirror-b", "cliproxy", "Mirror", false, true, null, null, "unsupported", null, null, null, "ok"),
        PoolRow("kiro-eu", "kiro", "Kiro EU", false, true, null, null, "unsupported", null, null, null, "warning"),
    ];

    internal static MainWindow CreateAnalyticsFixtureWindow(out BarViewModel vm, BarAnalytics analytics)
    {
        var clock = new FixtureClock();
        var settings = new TestSettings();
        vm = new BarViewModel(new FixtureConnector(new FixtureClient(ScreenshotRows(), analytics)), settings, clock);
        var window = CreateMainWindow(vm, clock, settings);
        vm.ReconnectAndLoadAsync(false).GetAwaiter().GetResult();
        window.Render();
        return window;
    }

    // ---- Task 9: settings window contracts ----

    /// <summary>In-memory settings store recording every Save for write-through assertions.</summary>
    sealed class SpySettings : IBarSettings
    {
        public int Saves { get; private set; }
        public BarUiSettings Ui { get; set; } = new();
        public BarPreferences Alerts { get; set; } = new() { QuotaLevelsValue = [20, 10, 0] };
        public IReadOnlySet<string> FiredKeys { get; set; } = new HashSet<string>();
        public void Save() => Saves++;
    }

    static bool SharedResourceContains(object? value)
    {
        bool Walk(ResourceDictionary dictionary)
        {
            if (dictionary.Values.Cast<object>().Any(v => ReferenceEquals(v, value))) return true;
            return dictionary.MergedDictionaries.Any(Walk);
        }
        return value is not null && Walk(s_app!.Resources);
    }

    static SettingsWindow CreateSettingsWindow(out BarViewModel vm, IBarSettings store, BarUiSettings? ui = null, BarPreferences? alerts = null)
    {
        if (ui is not null) store.Ui = ui;
        if (alerts is not null) store.Alerts = alerts;
        vm = new BarViewModel(new TestConnector(), store);
        return (SettingsWindow)Activator.CreateInstance(typeof(MainWindow).Assembly.GetType("CCSBar.App.SettingsWindow")!,
            BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic, null, [vm, store], null)!;
    }

    static void LayoutContent(Window window)
    {
        var content = (UIElement)window.Content;
        content.Measure(new Size(window.Width, window.Height));
        content.Arrange(new Rect(0, 0, window.Width, window.Height));
        content.UpdateLayout();
    }

    [STATestMethod]
    public void SettingsWindow_Runtime_Geometry_MatchesMacOSReference()
    {
        var window = CreateSettingsWindow(out _, new SpySettings());
        try
        {
            Assert.AreEqual("CCS Bar Settings", window.Title);
            Assert.AreEqual(460d, window.Width, "macOS setContentSize width 460");
            Assert.AreEqual(600d, window.Height, "macOS setContentSize height 600");
            Assert.AreEqual(420d, window.MinWidth, "macOS minSize width 420");
            Assert.AreEqual(520d, window.MinHeight, "macOS minSize height 520");
            Assert.AreEqual(ResizeMode.CanResize, window.ResizeMode, "macOS styleMask includes .resizable");
            var swift = File.ReadAllText(SwiftSettingsControllerPath);
            StringAssert.Contains(swift, "NSSize(width: 460, height: 600)");
            StringAssert.Contains(swift, "NSSize(width: 420, height: 520)");
        }
        finally { window.Close(); }
    }

    [STATestMethod]
    public void SettingsWindow_Runtime_Header_MatchesMacOSBellBadgeHeader()
    {
        var window = CreateSettingsWindow(out _, new SpySettings());
        try
        {
            LayoutContent(window);
            var root = (DependencyObject)window.Content;
            var headline = Text(root, "Alerts & Glance")!;
            Assert.IsNotNull(headline, "Header title 'Alerts & Glance' missing");
            Assert.AreEqual((double)s_resources!["FontSize.Headline"], headline.FontSize, "Headline uses shared token");
            Assert.AreEqual(FontWeights.SemiBold, headline.FontWeight);
            var bell = All<TextBlock>(root).FirstOrDefault(t => t.Text == "\uE7ED");
            Assert.IsNotNull(bell, "bell.badge icon missing");
            Assert.AreEqual(((SolidColorBrush)s_resources["AccentBrush"]).Color, ((SolidColorBrush)bell.Foreground).Color, "Bell renders in accent");
        }
        finally { window.Close(); }
    }

    [STATestMethod]
    public void SettingsWindow_Runtime_Sections_MatchMacOSHierarchy()
    {
        var store = new SpySettings();
        var window = CreateSettingsWindow(out _, store);
        try
        {
            LayoutContent(window);
            var root = (DependencyObject)window.Content;

            foreach (var section in new[] { "Appearance", "Menu-bar glance", "Updates", "Quota", "Opt-in · pay-per-use spend", "Account state" })
                Assert.IsNotNull(Text(root, section), $"Section label '{section}' missing");

            Assert.IsNotNull(Text(root, "Menu bar theme"), "Theme picker label missing");

            var segments = All<RadioButton>(root).ToArray();
            CollectionAssert.AreEqual(new[] { "System", "Light", "Dark" }, segments.Select(s => s.Content?.ToString()).ToArray(), "Segmented appearance picker");
            Assert.IsTrue(segments.Select(s => s.GroupName).Distinct().Count() == 1, "Segments behave as one group");
            Assert.IsTrue(segments.Single(s => Equals(s.Content, "Dark")).IsChecked == true, "Hydrated from stored appearance (default Dark)");

            Assert.IsNotNull(Text(root, "Show in menu bar"), "Glance picker label missing");
            var glance = DescendantsOf<ComboBox>(root).First();
            CollectionAssert.AreEqual(
                new[] { "Auto (smart)", "Today's spend", "This month's spend", "Lowest quota", "Active account count" },
                glance.Items.OfType<ComboBoxItem>().Select(i => i.Content?.ToString()).ToArray(), "Glance modes match macOS labels");
            Assert.AreEqual(0, glance.SelectedIndex, "Hydrated glance mode Auto");

            Assert.IsNotNull(Text(root, "Check for CCS Bar updates automatically"), "Updates toggle missing");
            Assert.IsNotNull(Text(root, "Alert on low quota"), "Quota toggle missing");
            Assert.IsNotNull(Text(root, "Levels (%)"), "Quota levels row label missing");
            var levels = All<TextBox>(root).First(t => t.Name == "QuotaLevels");
            Assert.AreEqual("20,10,0", levels.Text, "Levels hydrate comma-encoded descending");
            Assert.IsNotNull(Text(root, "Fires once per account at the most-severe level crossed, then again after the next quota reset."), "Quota caption missing");

            Assert.IsNotNull(Text(root, "Daily spend cap (pool accounts)"), "Daily toggle missing");
            Assert.IsNotNull(Text(root, "Daily cap"), "Daily cap row missing");
            Assert.IsNotNull(Text(root, "Monthly spend cap (pool accounts)"), "Monthly toggle missing");
            Assert.IsNotNull(Text(root, "Month cap"), "Month cap row missing");
            Assert.AreEqual(2, All<TextBlock>(root).Count(t => t.Text == "$"), "Cap fields show $ prefix");
            Assert.IsNotNull(Text(root, "Subscriptions are flat-rate and unaffected. These caps only watch metered pay-per-use pool spend, and are off until you enable them."), "Spend caption missing");

            Assert.IsNotNull(Text(root, "Alert when an account needs re-auth"), "Reauth toggle missing");
            Assert.IsNotNull(Text(root, "Alert when an account is paused / cooling down"), "Paused/cooldown toggle missing");
            Assert.IsNotNull(Text(root, "Alerts show as system notifications when allowed (System Settings › Notifications) and always appear in the menu's Alerts list."), "Notification delivery note missing");

            var done = Named<Button>(root, "Done");
            Assert.IsNotNull(done, "Footer Done button missing");
            Assert.IsTrue(done!.IsDefault, "Done is the default action (Return key)");
        }
        finally { window.Close(); }
    }

    [STATestMethod]
    public void SettingsWindow_Runtime_ExcludesPanelScopedControls()
    {
        var window = CreateSettingsWindow(out _, new SpySettings());
        try
        {
            LayoutContent(window);
            var root = (DependencyObject)window.Content;
            foreach (var banned in new[] { "Spend period", "Chart style", "Tray icon", "Keep alerts expanded" })
                Assert.IsNull(Text(root, banned), $"'{banned}' belongs to the panel, not settings");
            Assert.IsNull(Named<Button>(root, "Switch spend chart style"));
            var comboTexts = DescendantsOf<ComboBox>(root).SelectMany(c => c.Items.OfType<ComboBoxItem>()).Select(i => i.Content?.ToString()).ToArray();
            Assert.IsFalse(comboTexts.Any(t => t is "Today" or "Last 7 days" or "Last 30 days" or "Template" or "Color"), "No chart-period or tray-icon selectors");
        }
        finally { window.Close(); }
    }

    [STATestMethod]
    public void SettingsWindow_Runtime_UsesCcsStylesWithoutStockChrome()
    {
        var window = CreateSettingsWindow(out _, new SpySettings());
        try
        {
            LayoutContent(window);
            var root = (DependencyObject)window.Content;
            foreach (var button in All<Button>(root))
            {
                Assert.IsNotNull(button.Style, "Buttons must carry an explicit Ccs style");
                Assert.IsTrue(SharedResourceContains(button.Style), "Button style must come from shared Ccs resources");
                Assert.IsFalse(string.IsNullOrEmpty(AutomationProperties.GetName(button)), "Buttons need accessible names");
            }

            var quotaToggle = All<CheckBox>(root).First(c => c.Content?.ToString() == "Alert on low quota");
            quotaToggle.ApplyTemplate();
            Assert.IsNotNull(quotaToggle.Template.FindName("CheckBoxBorder", quotaToggle), "Toggles render through Ccs template, not stock chrome");

            var done = Named<Button>(root, "Done");
            Assert.IsNotNull(done, "Footer Done button missing");
            Assert.AreEqual(s_resources!["CcsButton.Primary"], done!.Style, "Done uses the primary Ccs button style");
        }
        finally { window.Close(); }

        var xaml = File.ReadAllText(SettingsWindowXamlPath);
        Assert.IsFalse(xaml.Contains("<GroupBox"), "Stock GroupBox chrome forbidden");
        StringAssert.Contains(xaml, "Background=\"{DynamicResource WindowBrush}\"", "Same theme pipeline as the panel");
    }

    [STATestMethod]
    public void SettingsWindow_Runtime_WriteThrough_PersistsEachChangeToStore()
    {
        var store = new SpySettings();
        store.Alerts = store.Alerts with { QuotaLevelsValue = [20, 10, 0] };
        var window = CreateSettingsWindow(out var vm, store);
        try
        {
            LayoutContent(window);
            var root = (DependencyObject)window.Content;

            var daily = All<CheckBox>(root).First(c => c.Content?.ToString() == "Daily spend cap (pool accounts)");
            daily.IsChecked = false;
            daily.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
            Assert.IsFalse(vm.AlertPreferences.DailySpendEnabled, "Toggle writes through immediately");
            var savesAfterToggle = store.Saves;
            Assert.IsTrue(savesAfterToggle > 0, "Every change persists through the settings store");

            var levels = All<TextBox>(root).First(t => t.Name == "QuotaLevels");
            levels.Text = "30, abc, 5, 200";
            levels.RaiseEvent(new RoutedEventArgs(UIElement.LostFocusEvent));
            CollectionAssert.AreEqual(new[] { 100, 30, 5 }, vm.AlertPreferences.QuotaLevels.ToArray(), "Levels normalize clamp+dedupe+desc");
            Assert.AreEqual("100,30,5", levels.Text, "Normalized form reflects back into the field");

            var glance = DescendantsOf<ComboBox>(root).First();
            glance.SelectedIndex = 2;
            Assert.AreEqual(BarGlanceMode.MonthSpend, vm.Ui.GlanceMode, "Glance picker writes through");
            Assert.AreEqual(BarGlanceMode.MonthSpend, vm.AlertPreferences.GlanceMode, "Alert prefs stay in sync with glance mode");

            All<RadioButton>(root).First(s => Equals(s.Content, "Light")).IsChecked = true;
            Assert.AreEqual(BarAppearance.Light, vm.Ui.Appearance, "Segment pick writes through");

            var updates = All<CheckBox>(root).First(c => c.Content?.ToString() == "Check for CCS Bar updates automatically");
            updates.IsChecked = false;
            updates.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
            Assert.IsFalse(vm.Ui.AutoCheckUpdates);

            // Store state mirrors the UI after every write-through, persisting again per change.
            Assert.AreEqual(BarAppearance.Light, store.Ui.Appearance);
            Assert.AreEqual(BarGlanceMode.MonthSpend, store.Ui.GlanceMode);
            Assert.IsFalse(store.Ui.AutoCheckUpdates);
            Assert.IsFalse(store.Alerts.DailySpendEnabled);
            CollectionAssert.AreEqual(new[] { 100, 30, 5 }, store.Alerts.QuotaLevels.ToArray());
            Assert.IsTrue(store.Saves > savesAfterToggle, "Later changes persisted again");
            var beforeDone = store.Saves;
            Named<Button>(root, "Done")!.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
            Assert.AreNotEqual(beforeDone, store.Saves, "Done commits pending field edits");
        }
        finally { window.Close(); }
    }

    [STATestMethod]
    public void SettingsWindow_Runtime_CapRows_DisableWithTheirToggle()
    {
        var window = CreateSettingsWindow(out _, new SpySettings());
        try
        {
            LayoutContent(window);
            var root = (DependencyObject)window.Content;
            var daily = All<CheckBox>(root).First(c => c.Content?.ToString() == "Daily spend cap (pool accounts)");
            var month = All<CheckBox>(root).First(c => c.Content?.ToString() == "Monthly spend cap (pool accounts)");
            var quota = All<CheckBox>(root).First(c => c.Content?.ToString() == "Alert on low quota");
            var capBoxes = All<TextBox>(root).Where(t => t.Name is "DailyCap" or "MonthCap").ToArray();
            var levels = All<TextBox>(root).First(t => t.Name == "QuotaLevels");

            Assert.IsTrue(capBoxes.All(t => t.IsEnabled), "Caps start enabled");
            Assert.IsTrue(levels.IsEnabled, "Levels start enabled");

            daily.IsChecked = false; daily.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
            month.IsChecked = false; month.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
            quota.IsChecked = false; quota.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
            Assert.IsFalse(capBoxes[0].IsEnabled, "Daily cap disables with its toggle");
            Assert.IsFalse(capBoxes[1].IsEnabled, "Month cap disables with its toggle");
            Assert.IsFalse(levels.IsEnabled, "Levels disable with quota toggle");

            quota.IsChecked = true; quota.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
            Assert.IsTrue(levels.IsEnabled, "Re-enabling restores the row");
        }
        finally { window.Close(); }
    }

    [TestMethod]
    public void SettingsWindow_CenterWithin_CentersAndClampsToWorkArea()
    {
        var centered = SettingsWindow.CenterWithin(new BarRect(0, 0, 1920, 1040), 460, 600);
        Assert.AreEqual(730d, centered.Left, 0.01, "Horizontal center");
        Assert.AreEqual(220d, centered.Top, 0.01, "Vertical center");

        var clamped = SettingsWindow.CenterWithin(new BarRect(100, 50, 300, 400), 460, 600);
        Assert.AreEqual(100d, clamped.Left, "Left edge clamps into work area");
        Assert.AreEqual(50d, clamped.Top, "Top edge clamps into work area");
    }

    [TestMethod]
    public void SettingsWindow_CentersOnTheCursorMonitor()
    {
        var source = File.ReadAllText(Path.Combine(ProjectRoot, "CCSBar.App", "SettingsWindow.xaml.cs"));
        StringAssert.Contains(source, "Forms.Screen.FromPoint(Forms.Cursor.Position)", "Placement resolves the cursor's monitor");
        StringAssert.Contains(source, "TransformFromDevice", "Screen bounds convert device pixels to DIPs");
        StringAssert.Contains(source, "CenterWithin", "Shared centering math drives placement");
    }

    [STATestMethod]
    public void MainWindow_Settings_Click_ReusesSingleSettingsInstance()
    {
        var window = CreateMainWindow(new BarViewModel(new TestConnector(), new TestSettings()));
        try
        {
            var click = typeof(MainWindow).GetMethod("Settings_Click", BindingFlags.Instance | BindingFlags.NonPublic)!;
            var field = typeof(MainWindow).GetField("settingsWindow", BindingFlags.Instance | BindingFlags.NonPublic)!;
            click.Invoke(window, [new Button(), new RoutedEventArgs()]);
            var first = (Window?)field.GetValue(window);
            Assert.IsNotNull(first, "First click opens the settings window");
            click.Invoke(window, [new Button(), new RoutedEventArgs()]);
            Assert.AreSame(first, field.GetValue(window), "Second click reuses the singleton instead of duplicating");
            first!.Close();
            Assert.IsNull(field.GetValue(window), "Close clears the handle so the next open rebuilds centered");
        }
        finally { window.Detach(); window.Close(); }
}
}
