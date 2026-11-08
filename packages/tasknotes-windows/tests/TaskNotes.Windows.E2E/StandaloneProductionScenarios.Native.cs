using System.Windows.Automation;
using TaskNotes.Windows.App.Acceptance;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.E2E;

public sealed partial class StandaloneProductionScenarios
{
    private static async Task ProtocolAsync(
        UiAutomationSession session,
        StandaloneAcceptanceDescriptor descriptor,
        List<string> passed,
        CancellationToken cancellation
    )
    {
        foreach (
            var route in new[]
            {
                ("inbox", "Inbox"),
                ("today", "Today"),
                ("upcoming", "Upcoming"),
                ("browse", "Browse"),
                ("completed", "Completed"),
            }
        )
        {
            session.RequireOwnedWindow();
            UiAutomationSession.ActivateProtocol("tasknotes-e2e://" + route.Item1);
            _ = await session.WaitForTextAsync(
                AutomationIds.DestinationTitle,
                text => text == route.Item2,
                cancellation
            );
        }
        UiAutomationSession.ActivateProtocol("tasknotes-e2e://kanban");
        _ = session.WaitForAutomationId(AutomationIds.Board, cancellation);
        UiAutomationSession.ActivateProtocol("tasknotes-e2e://settings");
        _ = session.WaitForAutomationId("Facet.Settings.Email", cancellation);
        passed.Add("activation.fixed");
        UiAutomationSession.ActivateProtocol("tasknotes-e2e://search?q=Synthetic");
        _ = await session.WaitForTextAsync(
            AutomationIds.Search,
            text => text == "Synthetic",
            cancellation
        );
        _ = session.WaitForName("Synthetic recovered Windows edit", cancellation);
        passed.Add("activation.search");
        string file = await CaptureAsync(
            session,
            descriptor,
            "Synthetic entity routes",
            cancellation
        );
        session.OpenTask("Synthetic entity routes");
        foreach (
            var field in new[]
            {
                (AutomationIds.EditorProjects, "Project/Acceptance"),
                (AutomationIds.EditorContexts, "desktop"),
                (AutomationIds.EditorTags, "task, acceptance"),
            }
        )
        {
            session.SetValue(field.Item1, field.Item2);
            session.Invoke(AutomationIds.EditorSave);
            string expected = field.Item1 == AutomationIds.EditorTags ? "acceptance" : field.Item2;
            await WaitAsync(
                () => File.ReadAllText(file).Contains(expected, StringComparison.Ordinal),
                cancellation
            );
        }
        foreach (
            var route in new[]
            {
                ("projects/Project%2FAcceptance", "Project/Acceptance"),
                ("contexts/desktop", "desktop"),
                ("tags/acceptance", "acceptance"),
            }
        )
        {
            UiAutomationSession.ActivateProtocol("tasknotes-e2e://" + route.Item1);
            _ = await session.WaitForTextAsync(
                AutomationIds.DestinationTitle,
                text => text == route.Item2,
                cancellation
            );
            _ = session.WaitForName("Synthetic entity routes", cancellation);
        }
        string relative = Path.GetRelativePath(descriptor.VaultDirectory, file).Replace('\\', '/');
        UiAutomationSession.ActivateProtocol(
            "tasknotes-e2e://tasks/" + Uri.EscapeDataString(relative)
        );
        _ = await session.WaitForTextAsync(
            AutomationIds.EditorTitle,
            text => text == "Synthetic entity routes",
            cancellation
        );
        passed.Add("activation.entities");
    }

    private static async Task BoardAsync(
        UiAutomationSession session,
        StandaloneAcceptanceDescriptor descriptor,
        List<string> passed,
        CancellationToken cancellation
    )
    {
        string file = await CaptureAsync(session, descriptor, "Synthetic board task", cancellation);
        session.InvokeByName("Board");
        _ = session.WaitForAutomationId(AutomationIds.Board, cancellation);
        foreach (
            string status in new[]
            {
                "open",
                "in-progress",
                "waiting",
                "delegated",
                "done",
                "cancelled",
            }
        )
            _ = session.WaitForAutomationId(AutomationIds.BoardColumn(status), cancellation);
        passed.Add("kanban.columns");
        var open = session.WaitForAutomationId(AutomationIds.BoardColumn("open"), cancellation);
        UiAutomationSession.InvokeDescendantByName(
            UiAutomationSession.WaitForNameWithin(open, "Synthetic board task", cancellation),
            "Move task to next configured status"
        );
        await session.WaitForPropertyAsync(file, "status", "in-progress", cancellation);
        var progress = session.WaitForAutomationId(
            AutomationIds.BoardColumn("in-progress"),
            cancellation
        );
        _ = UiAutomationSession.WaitForNameWithin(progress, "Synthetic board task", cancellation);
        passed.Add("kanban.move-persisted");
        byte[] before = await File.ReadAllBytesAsync(file, cancellation);
        string journal = Path.Combine(descriptor.EngineDirectory, "mutation-envelopes.json");
        using (var denied = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            UiAutomationSession.InvokeDescendantByName(
                UiAutomationSession.WaitForNameWithin(
                    progress,
                    "Synthetic board task",
                    cancellation
                ),
                "Move task to next configured status"
            );
            _ = await PendingDocumentAsync(journal, cancellation);
            CollectionAssert.AreEqual(before, await File.ReadAllBytesAsync(file, cancellation));
        }
        session.InvokeByName("Settings");
        _ = session.WaitForAutomationId("Facet.Settings.SavedActions", cancellation);
        _ = session.WaitForName("Resume saved action", cancellation);
        passed.Add("kanban.retained-file-failure-visible");
        session.InvokeByName("Resume saved action");
        await session.WaitForPropertyAsync(file, "status", "waiting", cancellation);
        passed.Add("recovery.board-retry-preserves-action");
        session.InvokeByName("Browse");
    }

    private static async Task AccessibilityAsync(
        UiAutomationSession session,
        List<string> passed,
        CancellationToken cancellation
    )
    {
        session.InvokeByName("Browse");
        session.SetValue(AutomationIds.Search, string.Empty);
        session.RequireOwnedWindow();
        var focusable = session.Window.FindAll(
            TreeScope.Descendants,
            new PropertyCondition(AutomationElement.IsKeyboardFocusableProperty, true)
        );
        Assert.IsGreaterThan(0, focusable.Count);
        foreach (AutomationElement element in focusable)
            Assert.IsFalse(
                string.IsNullOrWhiteSpace(element.Current.Name)
                    && string.IsNullOrWhiteSpace(element.Current.AutomationId)
            );
        var list = session.WaitForAutomationId(AutomationIds.TaskList, cancellation);
        Assert.AreEqual(ControlType.List, list.Current.ControlType);
        Assert.IsTrue(list.TryGetCurrentPattern(SelectionPattern.Pattern, out _));
        var search = session.WaitForAutomationId(AutomationIds.Search, cancellation);
        Assert.IsTrue(search.TryGetCurrentPattern(ValuePattern.Pattern, out _));
        passed.Add("accessibility.names-roles-values");
        session.Focus();
        session.SendOwnedKeys("^f");
        await WaitAsync(() => search.Current.HasKeyboardFocus, cancellation);
        passed.Add("keyboard.search-focus");
        session.InvokeByName("New task");
        var preview = session.WaitForAutomationId(AutomationIds.QuickAddPreview, cancellation);
        using ManualResetEventSlim announced = new(false);
        AutomationEventHandler handler = (_, _) => announced.Set();
        Automation.AddAutomationEventHandler(
            AutomationElementIdentifiers.LiveRegionChangedEvent,
            preview,
            TreeScope.Element,
            handler
        );
        try
        {
            session.SetValue(AutomationIds.QuickAddInput, "Synthetic accessible preview tomorrow");
            _ = await session.WaitForTextAsync(
                AutomationIds.QuickAddPreview,
                text => text.Contains("Synthetic accessible preview", StringComparison.Ordinal),
                cancellation
            );
            await WaitAsync(() => announced.IsSet, cancellation);
        }
        finally
        {
            Automation.RemoveAutomationEventHandler(
                AutomationElementIdentifiers.LiveRegionChangedEvent,
                preview,
                handler
            );
        }
        session.InvokeByName("Discard draft");
        session.InvokeByName("Keep draft");
        passed.Add("accessibility.live-status");
    }

    private static async Task ShellPersistenceAsync(
        UiAutomationSession session,
        List<string> passed,
        CancellationToken cancellation
    )
    {
        session.InvokeByName("Browse");
        session.InvokeByName("Toggle task inspector");
        bool hidden = InspectorHidden(session);
        var before = session.Window.Current.BoundingRectangle;
        await session.RestartAsync(cancellation);
        _ = await session.WaitForTextAsync(
            AutomationIds.DestinationTitle,
            text => text == "Browse",
            cancellation
        );
        var after = session.Window.Current.BoundingRectangle;
        Assert.AreEqual(before.Width, after.Width, 2);
        Assert.AreEqual(before.Height, after.Height, 2);
        Assert.AreEqual(hidden, InspectorHidden(session));
        passed.Add("window.state-restored");
    }

    private static bool InspectorHidden(UiAutomationSession session)
    {
        session.RequireOwnedWindow();
        var editor = session.Window.FindFirst(
            TreeScope.Descendants,
            new PropertyCondition(AutomationElement.AutomationIdProperty, AutomationIds.EditorTitle)
        );
        return editor is null || editor.Current.IsOffscreen;
    }

    private static async Task HotkeyAsync(
        UiAutomationSession session,
        string runId,
        List<string> passed,
        CancellationToken cancellation
    )
    {
        session.InvokeByName("Settings");
        session.SetValue(AutomationIds.Hotkey, "Ctrl+Alt+M");
        session.Invoke(AutomationIds.ApplyHotkey);
        _ = await session.WaitForTextAsync(
            AutomationIds.HotkeyStatus,
            text => text.Contains("Registered Ctrl+Alt+M", StringComparison.Ordinal),
            cancellation
        );
        OwnedKeyboardFocus.SendGlobalChord(runId, "^%m");
        _ = session.WaitForAutomationId(AutomationIds.QuickAddInput, cancellation);
        session.InvokeByName("Keep draft");
        session.Invoke(AutomationIds.ClearHotkey);
        _ = await session.WaitForTextAsync(
            AutomationIds.HotkeyStatus,
            text => text.Contains("disabled", StringComparison.OrdinalIgnoreCase),
            cancellation
        );
        OwnedKeyboardFocus.WithReservedChord(
            0x0003,
            'M',
            () =>
            {
                session.SetValue(AutomationIds.Hotkey, "Ctrl+Alt+M");
                session.Invoke(AutomationIds.ApplyHotkey);
                _ = session.WaitForText(
                    AutomationIds.HotkeyStatus,
                    text => text.Contains("already used", StringComparison.OrdinalIgnoreCase),
                    cancellation
                );
                session.Invoke(AutomationIds.ClearHotkey);
                _ = session.WaitForText(
                    AutomationIds.HotkeyStatus,
                    text => text.Contains("disabled", StringComparison.OrdinalIgnoreCase),
                    cancellation
                );
            }
        );
        passed.Add("hotkey.rebind-collision");
        passed.Add("hotkey.invoke-cancel");
    }
}
