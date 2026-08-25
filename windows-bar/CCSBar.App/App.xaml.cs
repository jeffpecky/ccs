using System.Drawing;
using System.Reflection;
using System.Net.Http;
using System.Windows;
using System.Windows.Forms;
using System.Windows.Media.Imaging;
using System.Runtime.InteropServices;
using CCSBar.Core;
using Microsoft.Win32;

namespace CCSBar.App;

public partial class App : System.Windows.Application
{
    const string InstanceName = "Local\\CCSBar.Windows.Instance";
    Mutex? mutex;
    EventWaitHandle? activateEvent;
    NotifyIcon? tray;
    MainWindow? panel;
    BarViewModel? viewModel;
    JsonBarSettings? settings;
    CancellationTokenSource shutdown = new();
    Task? activationTask;
    System.ComponentModel.PropertyChangedEventHandler? statusChanged;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        mutex = new(true, InstanceName, out var owner);
        if (!owner)
        {
            try { EventWaitHandle.OpenExisting(InstanceName + ".Activate").Set(); }
            catch { }
            Shutdown();
            return;
        }
        activateEvent = new(false, EventResetMode.AutoReset, InstanceName + ".Activate");
        settings = new();
        var connector = new WindowsBarConnector();
        ApplyTheme(settings.Ui.Appearance);
        SystemEvents.UserPreferenceChanged += SystemPreferenceChanged;
        tray = new NotifyIcon { Visible = true, Text = "CCS Bar", Icon = LoadTrayIcon(settings.Ui.IconStyle) };
        viewModel = new(connector, settings, updateChecker: ct => BarUpdate.FetchLatestPublishedVersionAsync(new HttpClient(), ct), currentVersion: VersionText.Value, notifier: new WindowsBarNotifier(tray, action => Dispatcher.BeginInvoke(action)));
        tray.MouseClick += (_, args) => { if (args.Button == MouseButtons.Left) TogglePanel(); };
        tray.ContextMenuStrip = new ContextMenuStrip();
        tray.ContextMenuStrip.Items.Add("Open", null, (_, _) => ShowPanel());
        tray.ContextMenuStrip.Items.Add("Quit", null, (_, _) => Exit());
        statusChanged = (_, args) => { if (args.PropertyName == nameof(BarViewModel.StatusTitle)) Dispatcher.BeginInvoke(UpdateTray); };
        viewModel.PropertyChanged += statusChanged;
        activationTask = Task.Run(() =>
        {
            while (!shutdown.IsCancellationRequested)
            {
                if (!activateEvent.WaitOne(250)) continue;
                if (!shutdown.IsCancellationRequested) Dispatcher.BeginInvoke(ShowPanel);
            }
        });
        viewModel.StartPolling();
        _ = viewModel.StartAsync();
        if (settings.Ui.AutoCheckUpdates) _ = viewModel.CheckForUpdatesAsync();
    }

    public void TogglePanel()
    {
        if (panel?.IsVisible == true) panel.Hide();
        else ShowPanel();
    }

    public async void ShowPanel()
    {
        if (tray is null || viewModel is null || settings is null) return;
        if (panel is null)
        {
            panel = new MainWindow(viewModel, settings);
        }
        await WaitForHealthAsync();
        panel.ShowAnchored(System.Windows.Forms.Cursor.Position);
        panel.Activate();
        _ = viewModel.OnPanelOpenedAsync();
    }

    async Task WaitForHealthAsync()
    {
        if (viewModel is null) return;
        var timeout = TimeSpan.FromSeconds(10);
        var start = DateTime.UtcNow;
        while (viewModel.IsStarting || viewModel.Offline)
        {
            if (DateTime.UtcNow - start > timeout) break;
            await Task.Delay(200);
            if (viewModel.IsRefreshing) await Task.Delay(100);
        }
    }

    public void SettingsChanged()
    {
        if (settings is null || tray is null) return;
        ApplyTheme(settings.Ui.Appearance);
        tray.Icon?.Dispose();
        tray.Icon = LoadTrayIcon(settings.Ui.IconStyle);
        panel?.Render();
        UpdateTray();
    }

    void UpdateTray()
    {
        if (tray is not null && viewModel is not null) tray.Text = viewModel.StatusTitle[..Math.Min(63, viewModel.StatusTitle.Length)];
    }

    public new async void Exit()
    {
        SystemEvents.UserPreferenceChanged -= SystemPreferenceChanged;
        tray?.Dispose();
        if (viewModel is not null && statusChanged is not null) viewModel.PropertyChanged -= statusChanged;
        panel?.Detach();
        shutdown.Cancel();
        activateEvent?.Set();
        if (viewModel is not null) await viewModel.DisposeAsync();
        if (activationTask is not null) await activationTask;
        activateEvent?.Dispose();
        shutdown.Dispose();
        mutex?.ReleaseMutex();
        mutex?.Dispose();
        Shutdown();
    }

    static Icon LoadTrayIcon(BarIconStyle style)
    {
        var name = style == BarIconStyle.Color ? "MenuBarColor.png" : "MenuBarTemplate.png";
        var stream = GetResourceStream(new Uri($"pack://application:,,,/Assets/{name}"))!.Stream;
        using var bitmap = new Bitmap(stream);
        var handle = bitmap.GetHicon();
        try { using var icon = Icon.FromHandle(handle); return (Icon)icon.Clone(); }
        finally { DestroyIcon(handle); }
    }

    [DllImport("user32.dll")]
    static extern bool DestroyIcon(IntPtr handle);

    public static void ApplyTheme(BarAppearance appearance)
    {
        var dark = appearance == BarAppearance.Dark || appearance == BarAppearance.System && !SystemUsesLightTheme();
        var p = dark ? BarThemePalette.Dark : BarThemePalette.Light;
        var resources = Current.Resources;
        resources["WindowBrush"] = Brush(dark ? "#E6202124" : p.WindowSurface);
        resources["TextBrush"] = Brush(p.Text);
        resources["MutedBrush"] = Brush(dark ? "#A8A8AC" : "#68686C");
        resources["BorderBrush"] = Brush(dark ? "#404044" : "#D7D7DB");
        resources["CardBrush"] = Brush(p.Text, .05);
        resources["TrackBrush"] = Brush(p.Text, .12);
        resources["AccentBrush"] = Brush(p.Accent);
        resources["PrimaryHoverBrush"] = Brush(p.Accent, .86);
        resources["PrimaryPressedBrush"] = Brush(p.Accent, .72);
        resources["SubscriptionBrush"] = Brush(p.Subscription);
        resources["GreenBrush"] = Brush(p.Green);
        resources["AmberBrush"] = Brush(p.Amber);
        resources["CoralBrush"] = Brush(p.Coral);
        resources["RedBrush"] = Brush(p.Red);
    }

    void SystemPreferenceChanged(object sender, UserPreferenceChangedEventArgs e)
    {
        if (settings?.Ui.Appearance != BarAppearance.System) return;
        Dispatcher.BeginInvoke(() => { ApplyTheme(BarAppearance.System); panel?.Render(); });
    }

    static bool SystemUsesLightTheme()
    {
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
        return key?.GetValue("AppsUseLightTheme") is not int value || value != 0;
    }

    static System.Windows.Media.Brush Brush(string value) => (System.Windows.Media.Brush)new System.Windows.Media.BrushConverter().ConvertFromString(value)!;
    static System.Windows.Media.Brush Brush(string value, double opacity) { var brush = Brush(value); brush.Opacity = opacity; return brush; }
}

static class VersionText { public static string Value => Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0"; }
