using TaskNotes.Windows.App.Acceptance;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.E2E;

public sealed partial class StandaloneProductionScenarios
{
    private static async Task OccurrenceRepairAsync(
        UiAutomationSession session,
        StandaloneAcceptanceDescriptor descriptor,
        List<string> passed,
        CancellationToken cancellation
    )
    {
        // Only the descriptor-owned synthetic configuration/template are fault inputs.
        // The real UI performs every generation, completion, Repair and Undo action.
        string vault = descriptor.VaultDirectory;
        string config = descriptor.ResolveSeed("tasknotes.yaml");
        string template = descriptor.ResolveSeed("Templates/acceptance-next.md");
        byte[] configBefore = await File.ReadAllBytesAsync(config, cancellation);
        byte[] templateBefore = await File.ReadAllBytesAsync(template, cancellation);
        var original = VaultBytes(vault);
        await File.AppendAllTextAsync(
            config,
            "\ntemplating:\n  enabled: false\n  template_path: ''\n  failure_mode: error_abort\n  unknown_variable_policy: preserve\n",
            cancellation
        );
        session.InvokeByName("Refresh tasks");
        session.InvokeByName("Browse");
        session.SetValue(AutomationIds.Search, string.Empty);
        var configured = VaultBytes(vault);
        session.OpenTaskByPath("Tasks/Deferred.md");
        session.Invoke("Facet.Editor.GenerateOccurrence");
        var dialog = session.WaitForName("Generate occurrence", cancellation);
        UiAutomationSession.SetElementValue(
            UiAutomationSession.WaitForNameWithin(dialog, "Occurrence date", cancellation),
            "2026-10-24"
        );
        session.InvokeByName("Generate");
        string[] children = await WaitForChildrenAsync(
            session,
            vault,
            "Tasks/Deferred.md",
            1,
            cancellation
        );
        string child = children.Single();
        await WaitForGeneratedRowsAsync(session, vault, children, cancellation);
        File.Delete(template);
        session.InvokeByName("Refresh tasks");
        string relative = Path.GetRelativePath(vault, child).Replace('\\', '/');
        UiAutomationSession.ToggleDescendant(
            session.WaitForAutomationId(AutomationIds.TaskRow(relative), cancellation)
        );
        await session.WaitForPropertyAsync(child, "status", "done", cancellation);
        session.InvokeByName("Settings");
        _ = session.WaitForName("Generation needs repair", cancellation);
        _ = session.WaitForName("Repair generation", cancellation);
        await session.CaptureScreenshotAsync(
            Path.Combine(descriptor.StateDirectory, "results", "04-generation-needs-repair.png"),
            cancellation
        );
        await File.WriteAllBytesAsync(template, templateBefore, cancellation);
        await session.RestartAsync(cancellation);
        session.InvokeByName("Settings");
        _ = session.WaitForName("Generation needs repair", cancellation);
        Assert.HasCount(
            1,
            await ReadChildrenAsync(session, vault, "Tasks/Deferred.md", cancellation),
            "Cold refresh must retain the original failure without silently retrying it after the template returns."
        );
        var beforeRepair = VaultBytes(vault);
        UiAutomationSession.InvokeDescendantByName(
            session.WaitForAutomationId("Facet.Settings.GenerationFailures", cancellation),
            "Repair generation"
        );
        _ = await WaitForChildrenAsync(session, vault, "Tasks/Deferred.md", 2, cancellation);
        await session.WaitForMutationSettlementAsync(cancellation);
        CollectionAssert.AreEqual(
            beforeRepair[Path.GetRelativePath(vault, child)],
            await File.ReadAllBytesAsync(child, cancellation),
            "Repair must preserve the already completed primary child exactly."
        );
        CollectionAssert.AreEqual(
            beforeRepair[Path.Combine("Tasks", "Deferred.md")],
            await File.ReadAllBytesAsync(descriptor.ResolveSeed("Tasks/Deferred.md"), cancellation),
            "Repair must preserve the already progressed series exactly."
        );
        await session.CaptureScreenshotAsync(
            Path.Combine(descriptor.StateDirectory, "results", "05-generation-repaired.png"),
            cancellation
        );
        session.InvokeByName("Undo last saved change");
        await WaitAsync(() => SameVaultBytes(beforeRepair, VaultBytes(vault)), cancellation);
        session.InvokeByName("Undo last saved change");
        await session.WaitForPropertyAsync(child, "status", "open", cancellation);
        session.InvokeByName("Undo last saved change");
        await WaitAsync(() => SameVaultBytes(configured, VaultBytes(vault)), cancellation);
        await File.WriteAllBytesAsync(config, configBefore, cancellation);
        session.InvokeByName("Refresh tasks");
        Assert.IsTrue(
            SameVaultBytes(original, VaultBytes(vault)),
            "The complete synthetic repair journey must return every fixture byte exactly."
        );
        passed.Add("occurrence.failed-next-cold-repair-undo");
    }

    private static async Task<string[]> ReadChildrenAsync(
        UiAutomationSession session,
        string vault,
        string parent,
        CancellationToken cancellation
    )
    {
        List<string> children = [];
        foreach (
            string file in Directory.EnumerateFiles(vault, "*.md", SearchOption.AllDirectories)
        )
        {
            var properties = await session.ReadPropertiesAsync(file, cancellation);
            if (
                properties is not { } values
                || !values.TryGetProperty("recurrence_parent", out var value)
            )
                continue;
            Assert.AreEqual(
                System.Text.Json.JsonValueKind.String,
                value.ValueKind,
                "Occurrence identity must retain its declared scalar type."
            );
            if (value.GetString() == "[[/" + parent + "]]")
                children.Add(file);
        }
        return children.ToArray();
    }

    private static async Task<string[]> WaitForChildrenAsync(
        UiAutomationSession session,
        string vault,
        string parent,
        int count,
        CancellationToken cancellation
    )
    {
        using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(
            cancellation
        );
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        while (true)
        {
            var children = await ReadChildrenAsync(session, vault, parent, timeout.Token);
            if (children.Length == count)
            {
                await session.WaitForMutationSettlementAsync(timeout.Token);
                return children;
            }
            await Task.Delay(TimeSpan.FromMilliseconds(100), timeout.Token);
        }
    }
}
