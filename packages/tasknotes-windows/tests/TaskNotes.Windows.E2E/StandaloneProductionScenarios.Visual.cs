using System.Windows.Automation;
using Microsoft.Win32;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.E2E;

public sealed partial class StandaloneProductionScenarios
{
    /// <summary>Captures app-only canonical states in a genuinely configured native display profile.</summary>
    [TestMethod, TestCategory("visual-modes")]
    public async Task StandaloneVisualProfile()
    {
        string requested = Required("TASKNOTES_E2E_VISUAL_VARIANT");
        Assert.AreEqual(requested, Required("TASKNOTES_E2E_VISUAL_ACTUAL"));
        var parts = requested.Split('-');
        if (parts.Length < 2 || parts[0] is not ("100" or "200"))
            throw new InvalidOperationException(
                "A declared 100/200 light, dark or high-contrast profile is required."
            );
        string theme = string.Join('-', parts.Skip(1));
        Assert.IsTrue(theme is "light" or "dark" or "high-contrast");
        Assert.AreEqual(theme == "high-contrast", SystemInformation.HighContrast);
        if (theme != "high-contrast")
        {
            using var personalize =
                Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"
                )
                ?? throw new InvalidOperationException(
                    "The current Windows theme configuration is unavailable."
                );
            Assert.AreEqual(theme == "light" ? 1 : 0, personalize.GetValue("AppsUseLightTheme"));
        }
        var cancellation = TestContext.CancellationToken;
        var run = await LaunchRunAsync(cancellation);
        string results = run.Results;
        await using var session = run.Session;
        session.RequireWindowScale(parts[0] == "100" ? 96u : 192u);
        session.InvokeByName("Browse");
        _ = session.WaitForName("E2E existing task", cancellation);
        var bounds = session.Window.Current.BoundingRectangle;
        Assert.IsGreaterThan(760, bounds.Width);
        Assert.IsGreaterThan(560, bounds.Height);
        foreach (
            AutomationElement element in session.Window.FindAll(
                TreeScope.Descendants,
                new PropertyCondition(AutomationElement.IsKeyboardFocusableProperty, true)
            )
        )
        {
            var item = element.Current.BoundingRectangle;
            Assert.IsTrue(
                element.Current.IsOffscreen
                    || item.IsEmpty
                    || bounds.Contains(item.TopLeft) && bounds.Contains(item.BottomRight)
            );
        }
        await session.CaptureScreenshotAsync(
            Path.Combine(results, "01-browse-" + requested + ".png"),
            cancellation
        );
        session.OpenTask("E2E existing task");
        _ = session.WaitForAutomationId(AutomationIds.EditorTitle, cancellation);
        await session.CaptureScreenshotAsync(
            Path.Combine(results, "02-inspector-" + requested + ".png"),
            cancellation
        );
        session.InvokeByName("New task");
        session.SetValue(
            AutomationIds.QuickAddInput,
            "Synthetic visual preview tomorrow #acceptance"
        );
        _ = await session.WaitForTextAsync(
            AutomationIds.QuickAddPreview,
            text => text.Contains("Synthetic visual preview", StringComparison.Ordinal),
            cancellation
        );
        await session.CaptureScreenshotAsync(
            Path.Combine(results, "03-capture-" + requested + ".png"),
            cancellation
        );
        session.InvokeByName("Discard draft");
        session.InvokeByName("Keep draft");
        session.InvokeByName("Board");
        _ = session.WaitForAutomationId(AutomationIds.Board, cancellation);
        await session.CaptureScreenshotAsync(
            Path.Combine(results, "04-board-" + requested + ".png"),
            cancellation
        );
        await WriteEvidenceAsync(
            run.Descriptor,
            "visual-modes",
            ["visual.profile-match", "visual.usable-bounds", "visual.screenshot"],
            cancellation
        );
    }
}
