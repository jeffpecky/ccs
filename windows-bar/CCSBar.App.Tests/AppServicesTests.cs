using CCSBar.App;
using CCSBar.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using System.Diagnostics;
using System.IO;

namespace CCSBar.App.Tests;

[TestClass]
public sealed class AppServicesTests
{
    [TestMethod]
    public void Dashboard_UsesActiveBaseUrl()
    {
        var opened = new List<ProcessCommand>();
        var launcher = new DashboardLauncher(command => { opened.Add(command); return null; });
        launcher.Open(new Uri("http://127.0.0.1:4321/"));
        Assert.AreEqual("http://127.0.0.1:4321/", opened.Single().FileName);
        Assert.IsTrue(opened.Single().UseShellExecute);
    }

    [TestMethod]
    public void Updater_DelegatesToInstallerContract()
    {
        var commands = new List<ProcessCommand>();
        var updater = new WindowsBarUpdater(command => { commands.Add(command); return null; });
        updater.Install();
        CollectionAssert.AreEqual(new[] { "/d", "/s", "/c", "ccs", "bar", "install", "--launch", "--await-quit" }, commands.Single().Arguments.ToArray());
        Assert.AreEqual("cmd.exe", commands.Single().FileName);
        Assert.IsFalse(commands.Single().UseShellExecute);
    }

    [TestMethod]
    public void RuntimeTrust_RejectsReparseAndNonPrivateShim()
    {
        var fs = new FakePathSecurity();
        var trust = new WindowsLaunchTrust(fs, @"C:\Users\me\AppData\Local\CCS Bar\launcher\ccs.js");
        fs.Reparse.Add(@"C:\Users\me\AppData\Local\CCS Bar\launcher");
        Assert.IsFalse(trust.IsTrustedFile(@"C:\Users\me\AppData\Local\CCS Bar\launcher\ccs.js"));
        Assert.IsFalse(trust.IsTrustedFile(@"C:\Users\me\Desktop\ccs.js"));
    }

    [TestMethod]
    public void AppShutdown_UsesPostedDispatchAndUnsubscribesBeforeAwaitingWorkers()
    {
        var source = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "CCSBar.App", "App.xaml.cs"));
        Assert.IsFalse(source.Contains("Dispatcher.Invoke"));
        StringAssert.Contains(source, "PropertyChanged -=");
        StringAssert.Contains(source, "BeginInvoke");
    }

    [TestMethod]
    public void Executable_HasIconAndGlyphControlsHaveAutomationNames()
    {
        var root = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..");
        StringAssert.Contains(File.ReadAllText(Path.Combine(root, "CCSBar.App", "CCSBar.App.csproj")), "ApplicationIcon");
        var xaml = File.ReadAllText(Path.Combine(root, "CCSBar.App", "MainWindow.xaml"));
        StringAssert.Contains(xaml, "AutomationProperties.Name=\"Force refresh CCS data\"");
    }

    [TestMethod]
    public void Panel_ActivationGrace_IgnoresOnlySettlingDeactivation()
    {
        var start = DateTimeOffset.Parse("2026-08-25T00:00:00Z");
        var guard = new PanelActivationGuard(TimeSpan.FromMilliseconds(250));
        guard.Activated(start);
        Assert.IsFalse(guard.ShouldHide(start.AddMilliseconds(100)), "settling deactivation ignored");
        Assert.IsTrue(guard.ShouldHide(start.AddMilliseconds(300)), "first genuine click-away hides");
        Assert.IsTrue(guard.ShouldHide(start.AddMilliseconds(301)), "grace is not a one-event swallow");
    }

    [TestMethod]
    public void App_CreatesPanelLazilyOnFirstActivation()
    {
        var source = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "CCSBar.App", "App.xaml.cs"));
        StringAssert.Contains(source, "panel");
        Assert.IsTrue(source.Contains("panel is null") || source.Contains("panel == null"));
    }

    [TestMethod]
    public void App_ShowsPanelBeforeAsyncRefresh()
    {
        var source = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "CCSBar.App", "App.xaml.cs"));
        var show = source.IndexOf("panel.ShowAnchored", StringComparison.Ordinal);
        var refresh = source.IndexOf("OnPanelOpenedAsync", StringComparison.Ordinal);
        Assert.IsTrue(show >= 0 && refresh > show, "Starting/Offline panel must display before startup refresh continues");
        Assert.IsFalse(source.Contains("WaitForHealthAsync"), "panel activation must not wait up to 10 seconds");
    }

    [TestMethod]
    public void AppProject_RestoresWinX64PublishGraph()
    {
        var project = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "CCSBar.App", "CCSBar.App.csproj"));
        StringAssert.Contains(project, "<RuntimeIdentifiers>win-x64</RuntimeIdentifiers>");
    }

    [TestMethod]
    public void App_SelfStartsServerOnDirectOpen()
    {
        var source = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "CCSBar.App", "App.xaml.cs"));
        StringAssert.Contains(source, "StartAsync");
    }

    sealed class FakePathSecurity : IWindowsPathSecurity
    {
        public HashSet<string> Reparse { get; } = new(StringComparer.OrdinalIgnoreCase);
        public bool FileExists(string path) => true;
        public bool DirectoryExists(string path) => true;
        public bool IsReparsePoint(string path) => Reparse.Contains(path);
        public bool IsSafeExecutable(string path) => true;
        public string Canonicalize(string path) => Path.GetFullPath(path);
    }
}
