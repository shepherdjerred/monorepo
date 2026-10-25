using TaskNotes.Windows.App.Acceptance;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.E2E;

public sealed partial class StandaloneProductionScenarios
{
    private static async Task OccurrencesAsync(
        UiAutomationSession session,
        StandaloneAcceptanceDescriptor descriptor,
        List<string> passed,
        CancellationToken cancellation
    )
    {
        session.InvokeByName("Browse");
        session.SetValue(AutomationIds.Search, string.Empty);
        string vault = descriptor.VaultDirectory;
        var before = VaultBytes(vault);
        Assert.IsFalse(
            before.Values.Any(bytes =>
                System
                    .Text.Encoding.UTF8.GetString(bytes)
                    .Contains("recurrence_parent:", StringComparison.Ordinal)
            ),
            "The synthetic Direct Sync profile has no initial remote barrier; startup must not pretend it is ready for automatic writes."
        );
        session.OpenTaskByPath("Tasks/Rolling.md");
        session.Invoke("Facet.Editor.GenerateWindow");
        string[] children = await WaitForChildrenAsync(
            session,
            vault,
            "Tasks/Rolling.md",
            3,
            cancellation
        );
        await WaitForGeneratedRowsAsync(session, vault, children, cancellation);
        session.InvokeByName("Undo last saved change");
        await WaitAsync(() => SameVaultBytes(before, VaultBytes(vault)), cancellation);
        passed.Add("occurrence.explicit-window-user-undo");
        session.OpenTaskByPath("Tasks/Rolling.md");
        session.Invoke("Facet.Editor.GenerateWindow");
        children = await WaitForChildrenAsync(session, vault, "Tasks/Rolling.md", 3, cancellation);
        await WaitForGeneratedRowsAsync(session, vault, children, cancellation);
        var generated = VaultBytes(vault);
        string child = children.Order(StringComparer.Ordinal).First();
        string relative = Path.GetRelativePath(vault, child).Replace('\\', '/');
        UiAutomationSession.ToggleDescendant(
            session.WaitForAutomationId(AutomationIds.TaskRow(relative), cancellation)
        );
        await session.WaitForPropertyAsync(child, "status", "done", cancellation);
        session.InvokeByName("Undo last saved change");
        await WaitAsync(() => SameVaultBytes(generated, VaultBytes(vault)), cancellation);
        passed.Add("completion.recurring-undo-exact-bytes");
        session.InvokeByName("Undo last saved change");
        await WaitAsync(() => SameVaultBytes(before, VaultBytes(vault)), cancellation);
    }

    private static async Task WaitForGeneratedRowsAsync(
        UiAutomationSession session,
        string vault,
        string[] children,
        CancellationToken cancellation
    )
    {
        await session.WaitForMutationSettlementAsync(cancellation);
        foreach (string child in children)
        {
            string relative = Path.GetRelativePath(vault, child).Replace('\\', '/');
            _ = session.WaitForAutomationId(AutomationIds.TaskRow(relative), cancellation);
        }
    }

    private static Dictionary<string, byte[]> VaultBytes(string vault) =>
        Directory
            .EnumerateFiles(vault, "*", SearchOption.AllDirectories)
            .ToDictionary(
                file => Path.GetRelativePath(vault, file),
                File.ReadAllBytes,
                StringComparer.Ordinal
            );

    private static bool SameVaultBytes(
        Dictionary<string, byte[]> expected,
        Dictionary<string, byte[]> actual
    ) =>
        expected.Count == actual.Count
        && expected.All(entry =>
            actual.TryGetValue(entry.Key, out byte[]? bytes)
            && entry.Value.AsSpan().SequenceEqual(bytes)
        );
}
