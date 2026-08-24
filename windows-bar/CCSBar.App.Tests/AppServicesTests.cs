using CCSBar.App;
using CCSBar.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

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

    sealed class FakePathSecurity : IWindowsPathSecurity
    {
        public HashSet<string> Reparse { get; } = new(StringComparer.OrdinalIgnoreCase);
        public bool FileExists(string path) => true;
        public bool DirectoryExists(string path) => true;
        public bool IsReparsePoint(string path) => Reparse.Contains(path);
        public string Canonicalize(string path) => Path.GetFullPath(path);
    }
}
