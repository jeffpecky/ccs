using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using CCSBar.App;
using CCSBar.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace CCSBar.App.Tests;

public enum VisualFixture { Offline, Starting, PopulatedLight, PopulatedDark, Alerts, Update }

[TestClass]
public sealed class VisualSnapshotTests
{
    static readonly string FixtureDirectory = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "CCSBar.App.Tests", "Fixtures"));

    [ClassInitialize]
    public static void ClassInit(TestContext context)
        => VisualContractTests.EnsureApplication();

    [STATestMethod]
    [DataRow(VisualFixture.Offline, "offline.png")]
    [DataRow(VisualFixture.Starting, "starting.png")]
    [DataRow(VisualFixture.PopulatedLight, "populated-light.png")]
    [DataRow(VisualFixture.PopulatedDark, "populated-dark.png")]
    [DataRow(VisualFixture.Alerts, "alerts.png")]
    [DataRow(VisualFixture.Update, "update.png")]
    public void MainWindow_MatchesBaseline(VisualFixture fixture, string fileName)
    {
        App.ApplyTheme(fixture == VisualFixture.PopulatedDark ? BarAppearance.Dark : BarAppearance.Light);
        var window = VisualContractTests.CreateVisualFixture(fixture);
        try
        {
            var actual = Render(window);
            var baseline = Path.Combine(FixtureDirectory, fileName);
            if (Environment.GetEnvironmentVariable("CCS_BAR_UPDATE_SNAPSHOTS") == "1")
            {
                Directory.CreateDirectory(FixtureDirectory);
                File.WriteAllBytes(baseline, actual);
                return;
            }

            Assert.IsTrue(File.Exists(baseline), $"Missing visual baseline: {baseline}");
            Compare(File.ReadAllBytes(baseline), actual, fileName);
        }
        finally
        {
            window.Detach();
            window.Close();
        }
    }

    static byte[] Render(Window window)
    {
        const int width = 360;
        var content = (FrameworkElement)window.Content;
        content.Measure(new Size(width, 900));
        var height = Math.Max(1, (int)Math.Ceiling(Math.Min(900, content.DesiredSize.Height)));
        content.Arrange(new Rect(0, 0, width, height));
        content.UpdateLayout();

        var bitmap = new RenderTargetBitmap(width, height, 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(content);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var stream = new MemoryStream();
        encoder.Save(stream);
        return stream.ToArray();
    }

    static void Compare(byte[] expectedPng, byte[] actualPng, string name)
    {
        var expected = Decode(expectedPng);
        var actual = Decode(actualPng);
        Assert.AreEqual(expected.PixelWidth, actual.PixelWidth, $"{name} width");
        Assert.AreEqual(expected.PixelHeight, actual.PixelHeight, $"{name} height");

        var stride = expected.PixelWidth * 4;
        var expectedPixels = new byte[stride * expected.PixelHeight];
        var actualPixels = new byte[stride * actual.PixelHeight];
        expected.CopyPixels(expectedPixels, stride, 0);
        actual.CopyPixels(actualPixels, stride, 0);

        var different = 0;
        for (var pixel = 0; pixel < expectedPixels.Length; pixel += 4)
        {
            if (Enumerable.Range(0, 4).Any(channel => Math.Abs(expectedPixels[pixel + channel] - actualPixels[pixel + channel]) > 8))
                different++;
        }

        var total = expected.PixelWidth * expected.PixelHeight;
        Assert.IsTrue(different <= total * .01, $"{name}: {different}/{total} pixels differ ({different * 100.0 / total:F2}%, max 1.00%) at channel tolerance 8");
    }

    static BitmapSource Decode(byte[] png)
    {
        using var stream = new MemoryStream(png);
        var decoder = new PngBitmapDecoder(stream, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
        var bitmap = new FormatConvertedBitmap(decoder.Frames[0], PixelFormats.Bgra32, null, 0);
        bitmap.Freeze();
        return bitmap;
    }
}
