using TaskNotes.Windows.App.Acceptance;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.E2E;

public sealed partial class StandaloneProductionScenarios
{
    private static async Task RetireRejectedAsync(
        UiAutomationSession session,
        StandaloneAcceptanceDescriptor descriptor,
        List<string> passed,
        CancellationToken cancellation
    )
    {
        string file = await CaptureAsync(
            session,
            descriptor,
            "Synthetic rejected edit",
            cancellation
        );
        session.OpenTask("Synthetic rejected edit");
        string journal = Path.Combine(descriptor.EngineDirectory, "mutation-envelopes.json");
        string retained;
        using (var deny = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            session.SetValue(
                AutomationIds.EditorTitle,
                "Synthetic edit requiring original revision"
            );
            session.Invoke(AutomationIds.EditorSave);
            retained = await PendingDocumentAsync(journal, cancellation);
        }
        // A real second editor changes the file after admission. The original decision
        // must conflict rather than overwrite these bytes or receive a new mutation ID.
        string concurrent =
            (await File.ReadAllTextAsync(file, cancellation))
            + "\nSynthetic concurrent editor sentinel.\n";
        await File.WriteAllTextAsync(file, concurrent, cancellation);
        session.InvokeByName("Discard retained draft");
        session.InvokeByName("Settings");
        session.InvokeByName("Resume saved action");
        Assert.AreEqual(retained, await PendingDocumentAsync(journal, cancellation));
        _ = session.WaitForName("Retire saved action", cancellation);
        passed.Add("recovery.rejected-action-visible");
        session.InvokeByName("Retire saved action");
        await WaitAsync(() => PendingCount(journal) == 0, cancellation);
        Assert.AreEqual(concurrent, await File.ReadAllTextAsync(file, cancellation));
        passed.Add("recovery.retire-rejected-action");
        session.InvokeByName("Browse");
    }
}
