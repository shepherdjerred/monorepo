using System.Windows.Automation;
using TaskNotes.Windows.App.Acceptance;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.E2E;

public sealed partial class StandaloneProductionScenarios
{
    private static async Task ExerciseLocalSurfacesAsync(
        UiAutomationSession session,
        StandaloneAcceptanceDescriptor descriptor,
        List<string> passed,
        CancellationToken cancellation
    )
    {
        await NavigationAsync(session, descriptor, passed, cancellation);
        await EditorAsync(session, descriptor, passed, cancellation);
        await BulkAsync(session, descriptor, passed, cancellation);
        await OccurrencesAsync(session, descriptor, passed, cancellation);
        await OccurrenceRepairAsync(session, descriptor, passed, cancellation);
        await SavedViewsAsync(session, descriptor, passed, cancellation);
        await ProtocolAsync(session, descriptor, passed, cancellation);
        await BoardAsync(session, descriptor, passed, cancellation);
        await RetireRejectedAsync(session, descriptor, passed, cancellation);
        await AccessibilityAsync(session, passed, cancellation);
        await ShellPersistenceAsync(session, passed, cancellation);
        await HotkeyAsync(session, descriptor.RunId, passed, cancellation);
    }

    private static async Task<string> CaptureAsync(
        UiAutomationSession session,
        StandaloneAcceptanceDescriptor descriptor,
        string title,
        CancellationToken cancellation
    )
    {
        session.InvokeByName("Browse");
        session.SetValue(AutomationIds.Search, string.Empty);
        session.InvokeByName("New task");
        session.SetValue(AutomationIds.QuickAddInput, title);
        _ = await session.WaitForTextAsync(
            AutomationIds.QuickAddPreview,
            text => text.Contains(title, StringComparison.Ordinal),
            cancellation
        );
        session.InvokeByName("Add task");
        _ = session.WaitForName(title, cancellation);
        return await FindTaskAsync(session, descriptor.VaultDirectory, title, cancellation);
    }

    private static async Task NavigationAsync(
        UiAutomationSession session,
        StandaloneAcceptanceDescriptor descriptor,
        List<string> passed,
        CancellationToken cancellation
    )
    {
        foreach (
            string destination in new[] { "Inbox", "Today", "Upcoming", "Browse", "Completed" }
        )
        {
            session.InvokeByName(destination);
            _ = await session.WaitForTextAsync(
                AutomationIds.DestinationTitle,
                text => text == destination,
                cancellation
            );
        }
        const string title = "Synthetic query target";
        string file = await CaptureAsync(session, descriptor, title, cancellation);
        session.SetValue(AutomationIds.Search, title);
        _ = session.WaitForName(title, cancellation);
        session.WaitForAutomationIdAbsent(AutomationIds.TaskRow("Tasks/Existing.md"), cancellation);
        passed.Add("query.search");
        session.ChooseMenuItem("Sort tasks", "Title");
        session.ChooseMenuItem("Group tasks", "Status");
        _ = session.WaitForName(title, cancellation);
        _ = session.WaitForName("Open", cancellation);
        passed.Add("query.sort-group");
        session.SetValue(AutomationIds.Search, string.Empty);
        UiAutomationSession.ToggleDescendant(session.WaitForName(title, cancellation));
        await session.WaitForPropertyAsync(file, "status", "done", cancellation);
        session.InvokeByName("Completed");
        _ = session.WaitForName(title, cancellation);
        passed.Add("navigation.fixed");
        session.InvokeByName("Browse");
    }

    private static async Task EditorAsync(
        UiAutomationSession session,
        StandaloneAcceptanceDescriptor descriptor,
        List<string> passed,
        CancellationToken cancellation
    )
    {
        await CaptureAsync(session, descriptor, "Synthetic full-field edit", cancellation);
        session.OpenTask("Synthetic full-field edit");
        session.SetValue(AutomationIds.EditorTitle, string.Empty);
        session.Invoke(AutomationIds.EditorSave);
        _ = await session.WaitForTextAsync(
            AutomationIds.SyncStatus,
            text => text.Contains("title", StringComparison.OrdinalIgnoreCase),
            cancellation
        );
        session.SetValue(AutomationIds.EditorTitle, "Synthetic validated edit");
        session.Invoke(AutomationIds.EditorSave);
        string file = await FindTaskAsync(
            session,
            descriptor.VaultDirectory,
            "Synthetic validated edit",
            cancellation
        );
        foreach (
            var field in new[]
            {
                (AutomationIds.EditorDetails, "Synthetic **details**", "Synthetic **details**"),
                (AutomationIds.EditorProjects, "Project/Acceptance", "Project/Acceptance"),
                (AutomationIds.EditorContexts, "desktop", "desktop"),
                (AutomationIds.EditorTags, "task, acceptance", "acceptance"),
                (AutomationIds.EditorScheduled, "2026-10-23", "2026-10-23"),
                (AutomationIds.EditorDue, "2026-10-24", "2026-10-24"),
            }
        )
        {
            session.SetValue(field.Item1, field.Item2);
            session.Invoke(AutomationIds.EditorSave);
            await WaitAsync(
                () => File.ReadAllText(file).Contains(field.Item3, StringComparison.Ordinal),
                cancellation
            );
        }
        session.SelectComboValueByAutomationId(AutomationIds.EditorStatus, "In progress");
        await session.WaitForPropertyAsync(file, "status", "in-progress", cancellation);
        session.SelectComboValueByAutomationId(AutomationIds.EditorPriority, "High");
        await session.WaitForPropertyAsync(file, "priority", "high", cancellation);
        foreach (
            var field in new[]
            {
                (
                    "Attachment references",
                    "Attachments/acceptance-preservation.bin",
                    "acceptance-preservation.bin"
                ),
                ("Created time", "2026-01-02T03:04:05Z", "2026-01-02T03:04:05Z"),
                ("Completed date", "2026-10-22", "2026-10-22"),
            }
        )
        {
            session.SetNamedValue(field.Item1, field.Item2);
            session.Invoke(AutomationIds.EditorSave);
            await WaitAsync(
                () => File.ReadAllText(file).Contains(field.Item3, StringComparison.Ordinal),
                cancellation
            );
        }
        session.InvokeByName("Add reminder");
        await WaitAsync(
            () => File.ReadAllText(file).Contains("-PT15M", StringComparison.Ordinal),
            cancellation
        );
        session.SetNamedValue("Relative offset", "-PT30M");
        session.Invoke(AutomationIds.EditorSave);
        await WaitAsync(
            () => File.ReadAllText(file).Contains("-PT30M", StringComparison.Ordinal),
            cancellation
        );
        session.SelectComboValue("Relative to", "Scheduled date");
        await WaitAsync(
            () => File.ReadAllText(file).Contains("relatedTo: scheduled", StringComparison.Ordinal),
            cancellation
        );
        session.InvokeByName("Remove reminder");
        await WaitAsync(
            () => !File.ReadAllText(file).Contains("-PT30M", StringComparison.Ordinal),
            cancellation
        );
        string dependency = await CaptureAsync(
            session,
            descriptor,
            "Synthetic dependency target",
            cancellation
        );
        session.OpenTask("Synthetic validated edit");
        string dependencyPath = Path.GetRelativePath(descriptor.VaultDirectory, dependency)
            .Replace('\\', '/');
        session.SetNamedValue("Dependencies", dependencyPath);
        session.Invoke(AutomationIds.EditorSave);
        await WaitAsync(
            () => File.ReadAllText(file).Contains(dependencyPath, StringComparison.Ordinal),
            cancellation
        );
        session.SetValue(AutomationIds.EditorRecurrence, "FREQ=WEEKLY");
        session.Invoke(AutomationIds.EditorSave);
        await WaitAsync(
            () => File.ReadAllText(file).Contains("FREQ=WEEKLY", StringComparison.Ordinal),
            cancellation
        );
        session.SelectComboValueByAutomationId(AutomationIds.EditorRecurrenceAnchor, "Scheduled");
        await WaitAsync(
            () =>
                File.ReadAllText(file)
                    .Contains("recurrence_anchor: scheduled", StringComparison.Ordinal),
            cancellation
        );
        foreach (
            var field in new[]
            {
                ("Completed occurrences", "2026-10-05"),
                ("Skipped occurrences", "2026-10-12"),
            }
        )
        {
            session.SetNamedValue(field.Item1, field.Item2);
            session.Invoke(AutomationIds.EditorSave);
            await WaitAsync(
                () => File.ReadAllText(file).Contains(field.Item2, StringComparison.Ordinal),
                cancellation
            );
        }
        passed.Add("editor.all-fields-markdown");
        byte[] before = await File.ReadAllBytesAsync(file, cancellation);
        using (var deny = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            session.SetValue(AutomationIds.EditorTitle, "Synthetic retained inspector draft");
            session.Invoke(AutomationIds.EditorSave);
            _ = await PendingDocumentAsync(
                Path.Combine(descriptor.EngineDirectory, "mutation-envelopes.json"),
                cancellation
            );
            Assert.AreEqual(
                "Synthetic retained inspector draft",
                (
                    (ValuePattern)
                        session
                            .WaitForAutomationId(AutomationIds.EditorTitle, cancellation)
                            .GetCurrentPattern(ValuePattern.Pattern)
                )
                    .Current
                    .Value
            );
            CollectionAssert.AreEqual(before, await File.ReadAllBytesAsync(file, cancellation));
        }
        // The admitted action must be resumed in Settings; retrying the inspector must not invent a second action.
        session.InvokeByName("Discard retained draft");
        session.InvokeByName("Settings");
        session.InvokeByName("Resume saved action");
        file = await FindTaskAsync(
            session,
            descriptor.VaultDirectory,
            "Synthetic retained inspector draft",
            cancellation
        );
        passed.Add("editor.validation-retained-draft");
        session.InvokeByName("Browse");
        session.OpenTask("Synthetic retained inspector draft");
        session.Invoke(AutomationIds.EditorDelete);
        session.InvokeByName("Continue");
        await WaitAsync(() => !File.Exists(file), cancellation);
        passed.Add("tasks.deleted-markdown");
    }

    private static async Task BulkAsync(
        UiAutomationSession session,
        StandaloneAcceptanceDescriptor descriptor,
        List<string> passed,
        CancellationToken cancellation
    )
    {
        string first = await CaptureAsync(session, descriptor, "Synthetic bulk one", cancellation);
        string second = await CaptureAsync(session, descriptor, "Synthetic bulk two", cancellation);
        byte[] firstBefore = await File.ReadAllBytesAsync(first, cancellation);
        byte[] secondBefore = await File.ReadAllBytesAsync(second, cancellation);
        session.SelectTaskRows("Synthetic bulk one", "Synthetic bulk two");
        session.InvokeByName("Complete selected tasks");
        foreach (string file in new[] { first, second })
            await session.WaitForPropertyAsync(file, "status", "done", cancellation);
        session.InvokeByName("Undo last saved change");
        await WaitAsync(
            () =>
                File.ReadAllBytes(first).AsSpan().SequenceEqual(firstBefore)
                && File.ReadAllBytes(second).AsSpan().SequenceEqual(secondBefore),
            cancellation
        );
        passed.Add("bulk.complete-undo-exact-bytes");
        session.SelectTaskRows("Synthetic bulk one", "Synthetic bulk two");
        session.InvokeByName("Schedule selected tasks");
        var dialog = session.WaitForName("Schedule selected tasks", cancellation);
        UiAutomationSession.SetElementValue(
            UiAutomationSession.WaitForNameWithin(dialog, "Scheduled date", cancellation),
            "2026-11-01"
        );
        session.InvokeByName("Apply");
        foreach (string file in new[] { first, second })
            await session.WaitForPropertyAsync(file, "scheduled", "2026-11-01", cancellation);
        session.SelectTaskRows("Synthetic bulk one", "Synthetic bulk two");
        session.InvokeByName("Prioritize selected tasks");
        session.SelectComboValueWithin(
            session.WaitForName("Prioritize selected tasks", cancellation),
            "high"
        );
        session.InvokeByName("Apply");
        foreach (string file in new[] { first, second })
            await session.WaitForPropertyAsync(file, "priority", "high", cancellation);
        session.SelectTaskRows("Synthetic bulk one", "Synthetic bulk two");
        session.InvokeByName("Delete selected tasks");
        session.InvokeByName("Continue");
        await WaitAsync(() => !File.Exists(first) && !File.Exists(second), cancellation);
        passed.Add("bulk.schedule-priority-delete");
    }

    private static async Task SavedViewsAsync(
        UiAutomationSession session,
        StandaloneAcceptanceDescriptor descriptor,
        List<string> passed,
        CancellationToken cancellation
    )
    {
        session.InvokeByName("Browse");
        session.SetValue(AutomationIds.Search, "Synthetic");
        session.InvokeByName("Save current query");
        var dialog = session.WaitForName("Save current query", cancellation);
        UiAutomationSession.SetElementValue(
            UiAutomationSession.WaitForNameWithin(dialog, "Name", cancellation),
            "Synthetic saved query"
        );
        session.InvokeByName("Save");
        _ = session.WaitForName("Synthetic saved query", cancellation);
        string view = await WaitForViewFileAsync(
            descriptor.VaultDirectory,
            "Synthetic saved query",
            cancellation
        );
        Assert.Contains("Synthetic", await File.ReadAllTextAsync(view, cancellation));
        passed.Add("saved-view.query");
        session.InvokeByName("Settings");
        UiAutomationSession.InvokeDescendantByName(
            session.WaitForAutomationId(Path.GetFileNameWithoutExtension(view), cancellation),
            "Duplicate"
        );
        string copyFile = await WaitForViewFileAsync(
            descriptor.VaultDirectory,
            "Synthetic saved query copy",
            cancellation
        );
        await session.RestartAsync(cancellation);
        session.InvokeByName("Settings");
        var copy = session.WaitForAutomationId(
            Path.GetFileNameWithoutExtension(copyFile),
            cancellation
        );
        UiAutomationSession.InvokeDescendantByName(copy, "Move up");
        UiAutomationSession.InvokeDescendantByName(
            session.WaitForAutomationId(Path.GetFileNameWithoutExtension(copyFile), cancellation),
            "Delete"
        );
        session.InvokeByName("Continue");
        UiAutomationSession.InvokeDescendantByName(
            session.WaitForAutomationId(Path.GetFileNameWithoutExtension(view), cancellation),
            "Delete"
        );
        session.InvokeByName("Continue");
        await WaitAsync(() => !File.Exists(view), cancellation);
        session.InvokeByName("Restore defaults");
        session.InvokeByName("Continue");
        foreach (string id in new[] { "default-all", "default-today", "default-upcoming" })
            await WaitAsync(
                () =>
                    File.Exists(
                        Path.Combine(descriptor.VaultDirectory, "Facet", "Views", id + ".md")
                    ),
                cancellation
            );
        passed.Add("saved-view.lifecycle-persistence");
    }

    private static async Task<string> WaitForViewFileAsync(
        string vault,
        string name,
        CancellationToken cancellation
    )
    {
        string? found = null;
        await WaitAsync(
            () =>
            {
                found = Directory
                    .EnumerateFiles(vault, "*.md", SearchOption.AllDirectories)
                    .SingleOrDefault(file =>
                    {
                        string text = File.ReadAllText(file);
                        return text.Contains("facetView:", StringComparison.Ordinal)
                            && text.Contains(name, StringComparison.Ordinal);
                    });
                return found is not null;
            },
            cancellation
        );
        return found
            ?? throw new AssertFailedException(
                "The saved view did not persist in its production vault."
            );
    }
}
