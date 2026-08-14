using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows.Automation;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.E2E
{
    internal static class ScenarioDriver
    {
        internal static async Task RunAsync(string scenarioId, CancellationToken cancellationToken)
        {
            ScenarioConfiguration configuration = ScenarioConfiguration.Load(scenarioId);
            ScenarioEvidence evidence = new(configuration);
            await using UiAutomationSession session = await UiAutomationSession.LaunchAsync(
                configuration,
                cancellationToken
            );
            try
            {
                await ExecuteAsync(session, configuration, evidence, cancellationToken);
                evidence.AssertComplete();
                await evidence.WriteAsync(true, cancellationToken);
            }
            catch
            {
                using CancellationTokenSource diagnosticTimeout = new(TimeSpan.FromSeconds(10));
                await evidence.WriteAsync(false, diagnosticTimeout.Token);
                await session.CaptureDiagnosticsAsync(
                    configuration.ArtifactDirectory,
                    diagnosticTimeout.Token
                );
                throw;
            }
        }

        private static async Task ExecuteAsync(
            UiAutomationSession session,
            ScenarioConfiguration configuration,
            ScenarioEvidence evidence,
            CancellationToken cancellationToken
        )
        {
            switch (configuration.ScenarioId)
            {
                case "onboarding-auth":
                    await OnboardingAsync(session, configuration, evidence, cancellationToken);
                    break;
                case "settings-credentials":
                    await ConfigureAsync(session, configuration, cancellationToken);
                    AssertTokenSeparation(configuration);
                    evidence.Record(
                        "credentials.token-separation",
                        EvidenceKind.Persistence,
                        "Auth token absent from every file in packaged LocalState after connected setup."
                    );
                    break;
                case "cached-offline-recovery":
                    await CachedOfflineRecoveryAsync(
                        session,
                        configuration,
                        evidence,
                        cancellationToken
                    );
                    break;
                case "navigation-query":
                    await NavigationQueryAsync(session, configuration, evidence, cancellationToken);
                    break;
                case "quick-add-create":
                    await ConfigureAsync(session, configuration, cancellationToken);
                    await QuickAddAsync(
                        session,
                        "Windows Quick Add e2e tomorrow !high p:Quality @desktop #windows",
                        "Windows Quick Add e2e",
                        "high",
                        evidence,
                        cancellationToken
                    );
                    string createdMarkdown = await WaitForVaultAsync(
                        configuration,
                        "Windows Quick Add e2e",
                        true,
                        cancellationToken
                    );
                    AssertMarkdownContains(
                        createdMarkdown,
                        "title: Windows Quick Add e2e",
                        "priority: high",
                        "Quality",
                        "desktop",
                        "windows"
                    );
                    evidence.Record(
                        "tasks.created-markdown",
                        EvidenceKind.Markdown,
                        "Server-created Markdown contains the parsed title, priority, project, context, and tag."
                    );
                    break;
                case "task-edit-delete":
                    await TaskEditingAsync(session, configuration, evidence, cancellationToken);
                    break;
                case "completion-recurrence-undo":
                    await CompletionUndoAsync(session, configuration, evidence, cancellationToken);
                    break;
                case "bulk-actions":
                    await BulkActionsAsync(session, configuration, evidence, cancellationToken);
                    break;
                case "saved-views":
                    await SavedViewsAsync(session, configuration, evidence, cancellationToken);
                    break;
                case "deep-links-entities":
                    await DeepLinksAsync(session, configuration, evidence, cancellationToken);
                    break;
                case "kanban":
                    await KanbanAsync(session, configuration, evidence, cancellationToken);
                    break;
                case "time-tracking-report":
                    await TimeTrackingAsync(session, configuration, evidence, cancellationToken);
                    break;
                case "pomodoro":
                    await PomodoroAsync(session, configuration, evidence, cancellationToken);
                    break;
                case "parked-errors":
                    await ParkedErrorsAsync(session, configuration, evidence, cancellationToken);
                    break;
                case "global-quick-add":
                    await GlobalQuickAddAsync(session, configuration, evidence, cancellationToken);
                    break;
                case "package-persistence":
                    await PackagePersistenceAsync(
                        session,
                        configuration,
                        evidence,
                        cancellationToken
                    );
                    break;
                case "accessibility-keyboard":
                    await AccessibilityAsync(session, configuration, evidence, cancellationToken);
                    break;
                case "visual-modes":
                    await VisualModesAsync(session, configuration, evidence, cancellationToken);
                    break;
                default:
                    throw new InvalidOperationException(
                        $"Unknown E2E scenario '{configuration.ScenarioId}'."
                    );
            }
        }

        private static async Task OnboardingAsync(
            UiAutomationSession session,
            ScenarioConfiguration configuration,
            ScenarioEvidence evidence,
            CancellationToken cancellationToken
        )
        {
            session.InvokeByName("Settings");
            session.SetValue(AutomationIds.ServerUrl, "not a TaskNotes URL");
            session.SetValue(AutomationIds.Token, string.Empty);
            session.Invoke(AutomationIds.SaveSettings);
            string invalid = await session.WaitForTextAsync(
                AutomationIds.SyncStatus,
                text =>
                    text.Contains("valid", StringComparison.OrdinalIgnoreCase)
                    || text.Contains("URL", StringComparison.OrdinalIgnoreCase),
                cancellationToken
            );
            evidence.Record(
                "settings.invalid-url",
                EvidenceKind.UIA,
                $"Settings live status rejected the invalid URL: {invalid}"
            );

            session.SetValue(AutomationIds.ServerUrl, configuration.ProxyUrl);
            session.Invoke(AutomationIds.SaveSettings);
            string authentication = await session.WaitForTextAsync(
                AutomationIds.SyncStatus,
                text => text.Contains("Authentication", StringComparison.OrdinalIgnoreCase),
                cancellationToken
            );
            evidence.Record(
                "settings.authentication",
                EvidenceKind.UIA,
                $"Unauthenticated setup reached the explicit auth state: {authentication}"
            );

            session.SetValue(AutomationIds.Token, configuration.AuthToken);
            session.Invoke(AutomationIds.SaveSettings);
            await WaitForConnectedAsync(session, cancellationToken);
            evidence.Record(
                "settings.connected",
                EvidenceKind.UIA,
                "Authenticated save-and-sync reached Connected state."
            );
        }

        private static async Task ConfigureAsync(
            UiAutomationSession session,
            ScenarioConfiguration configuration,
            CancellationToken cancellationToken
        )
        {
            session.InvokeByName("Settings");
            session.SetValue(AutomationIds.ServerUrl, configuration.ProxyUrl);
            session.SetValue(AutomationIds.Token, configuration.AuthToken);
            session.Invoke(AutomationIds.SaveSettings);
            await WaitForConnectedAsync(session, cancellationToken);
        }

        private static async Task WaitForConnectedAsync(
            UiAutomationSession session,
            CancellationToken cancellationToken
        )
        {
            _ = await session.WaitForTextAsync(
                AutomationIds.SyncStatus,
                text => text.Contains("Connected", StringComparison.Ordinal),
                cancellationToken
            );
        }

        private static void AssertTokenSeparation(ScenarioConfiguration configuration)
        {
            if (!Directory.Exists(configuration.AppLocalStateDirectory))
            {
                throw new AssertFailedException(
                    $"Missing E2E LocalState directory: {configuration.AppLocalStateDirectory}"
                );
            }
            foreach (
                string file in Directory.EnumerateFiles(
                    configuration.AppLocalStateDirectory,
                    "*",
                    SearchOption.AllDirectories
                )
            )
            {
                byte[] bytes = File.ReadAllBytes(file);
                string text = Encoding.UTF8.GetString(bytes);
                Assert.DoesNotContain(
                    configuration.AuthToken,
                    text,
                    $"Credential leaked into {file}"
                );
            }
        }

        private static async Task CachedOfflineRecoveryAsync(
            UiAutomationSession session,
            ScenarioConfiguration configuration,
            ScenarioEvidence evidence,
            CancellationToken cancellationToken
        )
        {
            await SeedTimeReportTaskAsync(configuration, cancellationToken);
            await ConfigureAsync(session, configuration, cancellationToken);
            await PostChaosAsync(configuration, "/__chaos/offline", null, cancellationToken);
            await QuickAddAsync(
                session,
                "Windows offline replay",
                "Windows offline replay",
                "normal",
                evidence: null,
                cancellationToken
            );
            string offline = await session.WaitForTextAsync(
                AutomationIds.SyncStatus,
                text =>
                    text.Contains("Offline", StringComparison.OrdinalIgnoreCase)
                    || text.Contains("pending", StringComparison.OrdinalIgnoreCase),
                cancellationToken
            );
            evidence.Record(
                "sync.offline",
                EvidenceKind.UIA,
                $"Chaos proxy offline mode produced a visible offline/pending state: {offline}"
            );
            await session.RestartAsync(cancellationToken);
            session.InvokeByName("Today");
            _ = session.WaitForName("Windows offline replay", cancellationToken);
            evidence.Record(
                "sync.cached-restart",
                EvidenceKind.Persistence,
                "Queued task was restored from the packaged cache after terminating and relaunching the app offline."
            );
            await PostChaosAsync(configuration, "/__chaos/online", null, cancellationToken);
            session.InvokeByName("Refresh tasks");
            await WaitForConnectedAsync(session, cancellationToken);
            string replayed = await WaitForVaultAsync(
                configuration,
                "Windows offline replay",
                true,
                cancellationToken
            );
            AssertMarkdownContains(replayed, "title: Windows offline replay");
            evidence.Record(
                "sync.replayed-markdown",
                EvidenceKind.Markdown,
                "The queued create replayed through the real server and appeared in the vault Markdown."
            );
        }

        private static async Task NavigationQueryAsync(
            UiAutomationSession session,
            ScenarioConfiguration configuration,
            ScenarioEvidence evidence,
            CancellationToken cancellationToken
        )
        {
            await ConfigureAsync(session, configuration, cancellationToken);
            foreach (string destination in new[] { "Inbox", "Today", "Upcoming", "Browse" })
            {
                session.InvokeByName(destination);
                _ = await session.WaitForTextAsync(
                    AutomationIds.DestinationTitle,
                    value => value.Equals(destination, StringComparison.Ordinal),
                    cancellationToken
                );
            }
            session.InvokeByName("Inbox");
            _ = session.WaitForName("Swipe delete task", cancellationToken);
            session.InvokeByName("Completed");
            _ = session.WaitForName("Seeded done task", cancellationToken);
            session.WaitForAutomationIdAbsent(
                AutomationIds.TaskRow("TaskNotes/seeded-open-task-1a2b3c4d.md"),
                cancellationToken
            );
            evidence.Record(
                "navigation.fixed",
                EvidenceKind.UIA,
                "All fixed destinations updated the destination heading; Inbox and Completed exposed their seeded members."
            );
            session.InvokeByName("Browse");
            session.SetValue(AutomationIds.Search, "Seeded");
            _ = session.WaitForName("Seeded open task", cancellationToken);
            session.WaitForAutomationIdAbsent(
                AutomationIds.TaskRow("TaskNotes/swipe-delete-task-5e6f7a8b.md"),
                cancellationToken
            );
            evidence.Record(
                "query.search",
                EvidenceKind.UIA,
                "Search retained the matching seeded task and excluded a nonmatching task row."
            );
            session.SelectComboValue("Sort tasks", "Title");
            session.SelectComboValue("Group tasks", "Status");
            AutomationElement seeded = session.WaitForName("Seeded open task", cancellationToken);
            _ = UiAutomationSession.WaitForNameWithin(seeded, "Open", cancellationToken);
            evidence.Record(
                "query.sort-group",
                EvidenceKind.UIA,
                "Title sort and Status grouping were applied and the projected row exposed its Open group label."
            );
        }

        private static async Task QuickAddAsync(
            UiAutomationSession session,
            string input,
            string expectedTitle,
            string expectedPriority,
            ScenarioEvidence? evidence,
            CancellationToken cancellationToken
        )
        {
            session.InvokeByName("New task");
            session.SetValue(AutomationIds.QuickAddInput, input);
            string preview = await session.WaitForTextAsync(
                AutomationIds.QuickAddPreview,
                text =>
                    text.Contains(expectedTitle, StringComparison.Ordinal)
                    && text.Contains(expectedPriority, StringComparison.OrdinalIgnoreCase),
                cancellationToken
            );
            evidence?.Record(
                "quick-add.preview",
                EvidenceKind.UIA,
                $"Rust-parsed preview exposed the expected title and priority: {preview}"
            );
            session.InvokeByName("Save");
            _ = session.WaitForName(expectedTitle, cancellationToken);
        }

        private static async Task TaskEditingAsync(
            UiAutomationSession session,
            ScenarioConfiguration configuration,
            ScenarioEvidence evidence,
            CancellationToken cancellationToken
        )
        {
            await ConfigureAsync(session, configuration, cancellationToken);
            await QuickAddAsync(
                session,
                "Windows edit source",
                "Windows edit source",
                "normal",
                evidence: null,
                cancellationToken
            );
            AutomationElement row = session.WaitForName("Windows edit source", cancellationToken);
            UiAutomationSession.InvokeDescendantByName(row, "Edit");
            session.SetValue(AutomationIds.EditorTitle, string.Empty);
            session.Invoke(AutomationIds.EditorSave);
            string validation = await session.WaitForTextAsync(
                AutomationIds.SyncStatus,
                text => text.Contains("title", StringComparison.OrdinalIgnoreCase),
                cancellationToken
            );
            session.SetValue(AutomationIds.EditorTitle, "Unsaved Windows title");
            session.InvokeByName("Browse");
            _ = session.WaitForName("Discard unsaved changes?", cancellationToken);
            session.InvokeByName("Cancel");
            AutomationElement stillEditing = session.WaitForAutomationId(
                AutomationIds.EditorTitle,
                cancellationToken
            );
            Assert.AreEqual("Unsaved Windows title", ReadValue(stillEditing));
            evidence.Record(
                "editor.validation-unsaved",
                EvidenceKind.UIA,
                $"Blank-title validation was announced ({validation}); navigation prompted and Cancel preserved unsaved text."
            );
            session.SetValue(AutomationIds.EditorTitle, "Windows edited task");
            session.SetValue(AutomationIds.EditorDetails, "Markdown **details** from Windows E2E");
            session.SelectComboValueByAutomationId(AutomationIds.EditorStatus, "In progress");
            session.SelectComboValueByAutomationId(AutomationIds.EditorPriority, "High");
            session.SetValue(AutomationIds.EditorScheduled, "2026-08-12");
            session.SetValue(AutomationIds.EditorDue, "2026-08-13");
            session.SetValue(AutomationIds.EditorRecurrence, "FREQ=WEEKLY");
            session.SelectComboValueByAutomationId(
                AutomationIds.EditorRecurrenceAnchor,
                "Scheduled"
            );
            session.SetValue(AutomationIds.EditorProjects, "Project/E2E");
            session.SetValue(AutomationIds.EditorContexts, "desktop");
            session.SetValue(AutomationIds.EditorTags, "windows, e2e");
            session.SetValue(AutomationIds.EditorEstimate, "45");
            session.Invoke(AutomationIds.EditorSave);
            string markdown = await WaitForVaultAsync(
                configuration,
                "Windows edited task",
                true,
                cancellationToken
            );
            AssertMarkdownContains(
                markdown,
                "title: Windows edited task",
                "status: in-progress",
                "priority: high",
                "scheduled: \"2026-08-12\"",
                "due: \"2026-08-13\"",
                "recurrence: FREQ=WEEKLY",
                "recurrence_anchor: scheduled",
                "Project/E2E",
                "desktop",
                "windows",
                "e2e",
                "timeEstimate: 45",
                "Markdown **details** from Windows E2E"
            );
            evidence.Record(
                "editor.all-fields-markdown",
                EvidenceKind.Markdown,
                "The real vault contains every editable field and Markdown details after save."
            );
            session.Invoke(AutomationIds.EditorDelete);
            session.InvokeByName("Continue");
            _ = await WaitForVaultAsync(
                configuration,
                "Windows edited task",
                false,
                cancellationToken
            );
            evidence.Record(
                "tasks.deleted-markdown",
                EvidenceKind.Markdown,
                "The edited task file disappeared from the real server vault after confirmed deletion."
            );
        }

        private static async Task CompletionUndoAsync(
            UiAutomationSession session,
            ScenarioConfiguration configuration,
            ScenarioEvidence evidence,
            CancellationToken cancellationToken
        )
        {
            await ConfigureAsync(session, configuration, cancellationToken);
            await QuickAddAsync(
                session,
                "Windows undo task",
                "Windows undo task",
                "normal",
                evidence: null,
                cancellationToken
            );
            AutomationElement row = session.WaitForName("Windows undo task", cancellationToken);
            UiAutomationSession.ToggleDescendant(row);
            string completed = await WaitForVaultAsync(
                configuration,
                "Windows undo task",
                true,
                cancellationToken
            );
            AssertMarkdownContains(completed, "status: done");
            session.InvokeByName("Undo");
            _ = session.WaitForName("Windows undo task", cancellationToken);
            string undone = await WaitForVaultAsync(
                configuration,
                "Windows undo task",
                true,
                cancellationToken
            );
            AssertMarkdownContains(undone, "status: open");
            evidence.Record(
                "completion.plain-undo",
                EvidenceKind.Markdown,
                "Plain completion wrote done to Markdown and LIFO undo restored open."
            );

            session.InvokeByName("Today");
            AutomationElement recurring = session.WaitForName("Water plants", cancellationToken);
            string recurringBefore = await WaitForVaultAsync(
                configuration,
                "Water plants",
                true,
                cancellationToken
            );
            UiAutomationSession.ToggleDescendant(recurring);
            string recurringCompleted = await WaitForVaultChangeAsync(
                configuration,
                "Water plants",
                recurringBefore,
                cancellationToken
            );
            Assert.Contains("complete_instances:", recurringCompleted);
            Assert.AreNotEqual(recurringBefore, recurringCompleted);
            session.InvokeByName("Undo");
            string recurringUndone = await WaitForVaultChangeAsync(
                configuration,
                "Water plants",
                recurringCompleted,
                cancellationToken
            );
            AssertMarkdownContains(recurringUndone, "complete_instances: []");
            evidence.Record(
                "completion.recurring-undo",
                EvidenceKind.Markdown,
                "Occurrence completion changed complete_instances and undo restored the original empty list."
            );
        }

        private static async Task BulkActionsAsync(
            UiAutomationSession session,
            ScenarioConfiguration configuration,
            ScenarioEvidence evidence,
            CancellationToken cancellationToken
        )
        {
            await ConfigureAsync(session, configuration, cancellationToken);
            await QuickAddAsync(
                session,
                "Windows bulk first",
                "Windows bulk first",
                "normal",
                evidence: null,
                cancellationToken
            );
            await QuickAddAsync(
                session,
                "Windows bulk second",
                "Windows bulk second",
                "normal",
                evidence: null,
                cancellationToken
            );
            session.SelectTaskRows("Windows bulk first", "Windows bulk second");
            session.InvokeByName("Complete selected tasks");
            string firstDone = await WaitForVaultAsync(
                configuration,
                "Windows bulk first",
                true,
                cancellationToken
            );
            string secondDone = await WaitForVaultAsync(
                configuration,
                "Windows bulk second",
                true,
                cancellationToken
            );
            AssertMarkdownContains(firstDone, "status: done");
            AssertMarkdownContains(secondDone, "status: done");
            session.InvokeByName("Undo last completion");
            _ = session.WaitForName("Windows bulk first", cancellationToken);
            _ = session.WaitForName("Windows bulk second", cancellationToken);
            AssertMarkdownContains(
                await WaitForVaultAsync(
                    configuration,
                    "Windows bulk first",
                    true,
                    cancellationToken
                ),
                "status: open"
            );
            AssertMarkdownContains(
                await WaitForVaultAsync(
                    configuration,
                    "Windows bulk second",
                    true,
                    cancellationToken
                ),
                "status: open"
            );
            evidence.Record(
                "bulk.complete-undo",
                EvidenceKind.Markdown,
                "Both selected files changed to done, and one bulk undo restored both to open."
            );

            session.SelectTaskRows("Windows bulk first", "Windows bulk second");
            session.InvokeByName("Schedule selected tasks");
            AutomationElement scheduleDialog = session.WaitForName(
                "Schedule selected tasks",
                cancellationToken
            );
            AutomationElement scheduledInput = UiAutomationSession.WaitForNameWithin(
                scheduleDialog,
                "Scheduled date",
                cancellationToken
            );
            UiAutomationSession.SetElementValue(scheduledInput, "2026-09-01");
            session.InvokeByName("Apply");
            await WaitForBothMarkdownAsync(
                configuration,
                "Windows bulk first",
                "Windows bulk second",
                text => text.Contains("scheduled: \"2026-09-01\"", StringComparison.Ordinal),
                cancellationToken
            );
            session.SelectTaskRows("Windows bulk first", "Windows bulk second");
            session.InvokeByName("Prioritize selected tasks");
            AutomationElement priorityDialog = session.WaitForName(
                "Prioritize selected tasks",
                cancellationToken
            );
            session.SelectComboValueWithin(priorityDialog, "high");
            session.InvokeByName("Apply");
            await WaitForBothMarkdownAsync(
                configuration,
                "Windows bulk first",
                "Windows bulk second",
                text => text.Contains("priority: high", StringComparison.Ordinal),
                cancellationToken
            );
            session.SelectTaskRows("Windows bulk first", "Windows bulk second");
            session.InvokeByName("Delete selected tasks");
            session.InvokeByName("Continue");
            _ = await WaitForVaultAsync(
                configuration,
                "Windows bulk first",
                false,
                cancellationToken
            );
            _ = await WaitForVaultAsync(
                configuration,
                "Windows bulk second",
                false,
                cancellationToken
            );
            evidence.Record(
                "bulk.schedule-priority-delete",
                EvidenceKind.Markdown,
                "Schedule and priority were persisted to both files before the confirmed bulk delete removed both."
            );
        }

        private static async Task SavedViewsAsync(
            UiAutomationSession session,
            ScenarioConfiguration configuration,
            ScenarioEvidence evidence,
            CancellationToken cancellationToken
        )
        {
            await ConfigureAsync(session, configuration, cancellationToken);
            session.InvokeByName("Browse");
            session.SetValue(AutomationIds.Search, "Seeded");
            session.InvokeByName("Save current query");
            AutomationElement name = session.WaitForFirstControl(
                ControlType.Edit,
                cancellationToken
            );
            UiAutomationSession.SetElementValue(name, "Windows saved search");
            session.InvokeByName("Save");
            _ = session.WaitForName("Windows saved search", cancellationToken);
            string savedViewsPath = Path.Combine(
                configuration.AppLocalStateDirectory,
                "TaskNotes",
                "saved-views.json"
            );
            string saved = await WaitForFileAsync(
                savedViewsPath,
                text => text.Contains("Windows saved search", StringComparison.Ordinal),
                cancellationToken
            );
            Assert.Contains("Seeded", saved);
            evidence.Record(
                "saved-view.query",
                EvidenceKind.Persistence,
                "saved-views.json contains the named view and its core query document."
            );
            session.InvokeByName("Settings");
            AutomationElement savedViews = session.WaitForAutomationId(
                AutomationIds.SavedViewsList,
                cancellationToken
            );
            AutomationElement savedRow = UiAutomationSession.WaitForNameWithin(
                savedViews,
                "Windows saved search",
                cancellationToken
            );
            UiAutomationSession.InvokeDescendantByName(savedRow, "Duplicate");
            _ = await WaitForFileAsync(
                savedViewsPath,
                text => text.Contains("Windows saved search Copy", StringComparison.Ordinal),
                cancellationToken
            );
            await session.RestartAsync(cancellationToken);
            session.InvokeByName("Settings");
            AutomationElement restartedSavedViews = session.WaitForAutomationId(
                AutomationIds.SavedViewsList,
                cancellationToken
            );
            _ = UiAutomationSession.WaitForNameWithin(
                restartedSavedViews,
                "Windows saved search",
                cancellationToken
            );
            AutomationElement duplicate = UiAutomationSession.WaitForNameWithin(
                restartedSavedViews,
                "Windows saved search Copy",
                cancellationToken
            );
            UiAutomationSession.InvokeDescendantByName(duplicate, "Move up");
            UiAutomationSession.InvokeDescendantByName(duplicate, "Delete");
            session.InvokeByName("Continue");
            session.InvokeByName("Restore defaults");
            session.InvokeByName("Continue");
            string restored = await WaitForFileAsync(
                savedViewsPath,
                text =>
                    text.Contains("Job Search", StringComparison.Ordinal)
                    && text.Contains("School", StringComparison.Ordinal)
                    && !text.Contains("Windows saved search", StringComparison.Ordinal),
                cancellationToken
            );
            Assert.Contains("job-search", restored);
            evidence.Record(
                "saved-view.lifecycle-persistence",
                EvidenceKind.Persistence,
                "Duplicate survived restart; delete and restore-default rewrote the local saved-view document to the defaults."
            );
        }

        private static async Task DeepLinksAsync(
            UiAutomationSession session,
            ScenarioConfiguration configuration,
            ScenarioEvidence evidence,
            CancellationToken cancellationToken
        )
        {
            await ConfigureAsync(session, configuration, cancellationToken);
            foreach (
                (string Route, string Destination) pair in new[]
                {
                    ("inbox", "Inbox"),
                    ("today", "Today"),
                    ("upcoming", "Upcoming"),
                    ("browse", "Browse"),
                    ("completed", "Completed"),
                }
            )
            {
                UiAutomationSession.ActivateProtocol($"tasknotes-e2e://{pair.Route}");
                _ = await session.WaitForTextAsync(
                    AutomationIds.DestinationTitle,
                    text => text.Equals(pair.Destination, StringComparison.Ordinal),
                    cancellationToken
                );
            }
            UiAutomationSession.ActivateProtocol("tasknotes-e2e://kanban");
            _ = session.WaitForAutomationId(AutomationIds.Board, cancellationToken);
            UiAutomationSession.ActivateProtocol("tasknotes-e2e://settings");
            _ = session.WaitForAutomationId(AutomationIds.ServerUrl, cancellationToken);
            UiAutomationSession.ActivateProtocol("tasknotes-e2e://pomodoro");
            _ = session.WaitForAutomationId(AutomationIds.PomodoroWindow, cancellationToken);
            UiAutomationSession.ActivateProtocol("tasknotes-e2e://time-report");
            _ = session.WaitForAutomationId(AutomationIds.TimeReportWindow, cancellationToken);
            evidence.Record(
                "activation.fixed",
                EvidenceKind.UIA,
                "Every fixed-list, board, settings, Pomodoro, and Time Report protocol route reached its concrete destination."
            );
            UiAutomationSession.ActivateProtocol("tasknotes-e2e://search?q=Seeded");
            _ = await session.WaitForTextAsync(
                AutomationIds.Search,
                text => text.Equals("Seeded", StringComparison.Ordinal),
                cancellationToken
            );
            _ = session.WaitForName("Seeded open task", cancellationToken);
            evidence.Record(
                "activation.search",
                EvidenceKind.UIA,
                "Search activation populated the query and projected a matching seeded task."
            );

            foreach (
                (string Uri, string Destination) scoped in new[]
                {
                    ("tasknotes-e2e://projects/Project%2FE2E", "Project/E2E"),
                    ("tasknotes-e2e://contexts/home", "home"),
                    ("tasknotes-e2e://tags/seeded", "seeded"),
                    ("tasknotes-e2e://saved-views/job-search", "Job Search"),
                }
            )
            {
                UiAutomationSession.ActivateProtocol(scoped.Uri);
                _ = await session.WaitForTextAsync(
                    AutomationIds.DestinationTitle,
                    text => text.Equals(scoped.Destination, StringComparison.Ordinal),
                    cancellationToken
                );
            }
            UiAutomationSession.ActivateProtocol(
                "tasknotes-e2e://tasks/TaskNotes%2Fseeded-open-task-1a2b3c4d.md"
            );
            _ = await session.WaitForTextAsync(
                AutomationIds.EditorTitle,
                text => text.Equals("Seeded open task", StringComparison.Ordinal),
                cancellationToken
            );
            evidence.Record(
                "activation.entities",
                EvidenceKind.UIA,
                "Project, context, tag, saved-view, and task routes reached their scoped headings or task inspector."
            );
        }

        private static async Task KanbanAsync(
            UiAutomationSession session,
            ScenarioConfiguration configuration,
            ScenarioEvidence evidence,
            CancellationToken cancellationToken
        )
        {
            await ConfigureAsync(session, configuration, cancellationToken);
            session.InvokeByName("Board");
            _ = session.WaitForAutomationId(AutomationIds.Board, cancellationToken);
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
            {
                _ = session.WaitForAutomationId(
                    AutomationIds.BoardColumn(status),
                    cancellationToken
                );
            }
            evidence.Record(
                "kanban.columns",
                EvidenceKind.UIA,
                "All six status columns are present in the UIA tree."
            );
            AutomationElement openColumn = session.WaitForAutomationId(
                AutomationIds.BoardColumn("open"),
                cancellationToken
            );
            AutomationElement seeded = UiAutomationSession.WaitForNameWithin(
                openColumn,
                "Seeded open task",
                cancellationToken
            );
            UiAutomationSession.InvokeDescendantByName(seeded, "Move task to next status");
            AutomationElement progressColumn = session.WaitForAutomationId(
                AutomationIds.BoardColumn("in-progress"),
                cancellationToken
            );
            _ = UiAutomationSession.WaitForNameWithin(
                progressColumn,
                "Seeded open task",
                cancellationToken
            );
            string moved = await WaitForVaultAsync(
                configuration,
                "Seeded open task",
                true,
                cancellationToken
            );
            AssertMarkdownContains(moved, "status: in-progress");
            evidence.Record(
                "kanban.move-persisted",
                EvidenceKind.Markdown,
                "The keyboard-accessible board command moved the task to In progress and persisted status in Markdown."
            );

            const string failure = /*lang=json,strict*/
                "{\"method\":\"PUT\",\"path\":\"/api/tasks/TaskNotes%2Fseeded-open-task-1a2b3c4d.md\",\"status\":500,\"body\":\"{\\\"error\\\":\\\"kanban e2e\\\"}\"}";
            await PostChaosAsync(configuration, "/__chaos/fail-next", failure, cancellationToken);
            AutomationElement movedRow = UiAutomationSession.WaitForNameWithin(
                progressColumn,
                "Seeded open task",
                cancellationToken
            );
            UiAutomationSession.InvokeDescendantByName(movedRow, "Move task to next status");
            string error = await session.WaitForTextAsync(
                AutomationIds.SyncStatus,
                text =>
                    text.Contains("error", StringComparison.OrdinalIgnoreCase)
                    || text.Contains("failed", StringComparison.OrdinalIgnoreCase),
                cancellationToken
            );
            evidence.Record(
                "kanban.failure-visible",
                EvidenceKind.UIA,
                $"Injected board mutation failure surfaced in the live status instead of disappearing: {error}"
            );
        }

        private static async Task TimeTrackingAsync(
            UiAutomationSession session,
            ScenarioConfiguration configuration,
            ScenarioEvidence evidence,
            CancellationToken cancellationToken
        )
        {
            await ConfigureAsync(session, configuration, cancellationToken);
            AutomationElement row = session.WaitForName("Seeded open task", cancellationToken);
            UiAutomationSession.InvokeDescendantByName(row, "Edit");
            session.InvokeByName("Start timer");
            await AssertTaskTimeStateAsync(
                configuration,
                "TaskNotes/seeded-open-task-1a2b3c4d.md",
                expectedActive: true,
                cancellationToken
            );
            session.InvokeByName("Stop timer");
            await AssertTaskTimeStateAsync(
                configuration,
                "TaskNotes/seeded-open-task-1a2b3c4d.md",
                expectedActive: false,
                cancellationToken
            );
            evidence.Record(
                "timing.task-server",
                EvidenceKind.Server,
                "The live task-time endpoint reported active after Start and inactive after Stop."
            );
            string markdown = await WaitForVaultAsync(
                configuration,
                "Seeded open task",
                true,
                cancellationToken
            );
            AssertMarkdownContains(markdown, "timeEntries:", "startTime:", "endTime:");
            evidence.Record(
                "timing.markdown",
                EvidenceKind.Markdown,
                "The server persisted a completed start/end time entry in the task Markdown."
            );
            session.InvokeByName("Open Time Report");
            AutomationElement report = session.WaitForAutomationId(
                AutomationIds.TimeReportWindow,
                cancellationToken
            );
            _ = UiAutomationSession.WaitForNameWithin(
                report,
                "Windows time report seed",
                cancellationToken
            );
            _ = await session.WaitForTextAsync(
                AutomationIds.TimeReportTotal,
                text => text.StartsWith("Total:", StringComparison.Ordinal),
                cancellationToken
            );
            evidence.Record(
                "timing.report-ui",
                EvidenceKind.UIA,
                "Time Report exposed the tracked task row and an aggregate Total value from the server."
            );
        }

        private static async Task PomodoroAsync(
            UiAutomationSession session,
            ScenarioConfiguration configuration,
            ScenarioEvidence evidence,
            CancellationToken cancellationToken
        )
        {
            await ConfigureAsync(session, configuration, cancellationToken);
            session.InvokeByName("Open Pomodoro");
            AutomationElement window = session.WaitForAutomationId(
                AutomationIds.PomodoroWindow,
                cancellationToken
            );
            UiAutomationSession.InvokeDescendantByName(window, "Start");
            await AssertPomodoroStateAsync(configuration, expectedActive: true, cancellationToken);
            _ = await session.WaitForTextAsync(
                AutomationIds.PomodoroStatus,
                text => text.Contains("remaining", StringComparison.OrdinalIgnoreCase),
                cancellationToken
            );
            session.InvokeByName("Open Pomodoro");
            Assert.AreEqual(1, session.CountTopLevelWindows("TaskNotes Pomodoro"));
            evidence.Record(
                "window.pomodoro-singleton",
                EvidenceKind.UIA,
                "Reopening Pomodoro retained one top-level auxiliary window for the app process."
            );
            UiAutomationSession.InvokeDescendantByName(window, "Pause / resume");
            await AssertPomodoroStateAsync(configuration, expectedActive: true, cancellationToken);
            UiAutomationSession.InvokeDescendantByName(window, "Pause / resume");
            await AssertPomodoroStateAsync(configuration, expectedActive: true, cancellationToken);
            UiAutomationSession.InvokeDescendantByName(window, "Stop");
            await AssertPomodoroStateAsync(configuration, expectedActive: false, cancellationToken);
            evidence.Record(
                "pomodoro.server-lifecycle",
                EvidenceKind.Server,
                "The real server reported active through start/pause/resume and inactive after stop."
            );
        }

        private static async Task ParkedErrorsAsync(
            UiAutomationSession session,
            ScenarioConfiguration configuration,
            ScenarioEvidence evidence,
            CancellationToken cancellationToken
        )
        {
            await ConfigureAsync(session, configuration, cancellationToken);
            const string failure = /*lang=json,strict*/
                "{\"method\":\"POST\",\"path\":\"/api/tasks\",\"status\":422,\"body\":\"{\\\"error\\\":\\\"permanent e2e\\\"}\"}";
            await PostChaosAsync(configuration, "/__chaos/fail-next", failure, cancellationToken);
            await QuickAddAsync(
                session,
                "Windows parked mutation",
                "Windows parked mutation",
                "normal",
                evidence: null,
                cancellationToken
            );
            string parked = await session.WaitForTextAsync(
                AutomationIds.SyncStatus,
                text => text.Contains("parked", StringComparison.OrdinalIgnoreCase),
                cancellationToken
            );
            evidence.Record(
                "sync.parked",
                EvidenceKind.UIA,
                $"A permanent 422 mutation became a visible parked state: {parked}"
            );
            session.InvokeByName("Settings");
            AutomationElement parkedList = session.WaitForAutomationId(
                AutomationIds.ParkedChangesList,
                cancellationToken
            );
            AutomationElement parkedRow = UiAutomationSession.WaitForNameWithin(
                parkedList,
                "permanent e2e",
                cancellationToken
            );
            UiAutomationSession.InvokeDescendantByName(parkedRow, "Retry parked change");
            string replayed = await WaitForVaultAsync(
                configuration,
                "Windows parked mutation",
                true,
                cancellationToken
            );
            AssertMarkdownContains(replayed, "title: Windows parked mutation");

            await PostChaosAsync(configuration, "/__chaos/fail-next", failure, cancellationToken);
            await QuickAddAsync(
                session,
                "Windows discarded mutation",
                "Windows discarded mutation",
                "normal",
                evidence: null,
                cancellationToken
            );
            _ = await session.WaitForTextAsync(
                AutomationIds.SyncStatus,
                text => text.Contains("parked", StringComparison.OrdinalIgnoreCase),
                cancellationToken
            );
            session.InvokeByName("Settings");
            AutomationElement discardList = session.WaitForAutomationId(
                AutomationIds.ParkedChangesList,
                cancellationToken
            );
            AutomationElement discardRow = UiAutomationSession.WaitForNameWithin(
                discardList,
                "permanent e2e",
                cancellationToken
            );
            UiAutomationSession.InvokeDescendantByName(discardRow, "Discard parked change");
            _ = await WaitForVaultAsync(
                configuration,
                "Windows discarded mutation",
                false,
                cancellationToken
            );
            evidence.Record(
                "sync.retry-discard",
                EvidenceKind.Markdown,
                "Retry replayed one parked create to Markdown; discard removed a second without creating a file."
            );
        }

        private static async Task GlobalQuickAddAsync(
            UiAutomationSession session,
            ScenarioConfiguration configuration,
            ScenarioEvidence evidence,
            CancellationToken cancellationToken
        )
        {
            await ConfigureAsync(session, configuration, cancellationToken);
            using Process notepad =
                Process.Start(new ProcessStartInfo("notepad.exe") { UseShellExecute = true })
                ?? throw new InvalidOperationException(
                    "Unable to start Notepad for the global-hotkey scenario."
                );
            _ = notepad.WaitForInputIdle(10_000);
            notepad.WaitForExit(250);
            SendKeys.SendWait("^%n");
            _ = session.WaitForAutomationId(AutomationIds.QuickAddInput, cancellationToken);
            session.InvokeByName("Cancel");
            evidence.Record(
                "hotkey.invoke-cancel",
                EvidenceKind.UIA,
                "Ctrl+Alt+N opened Quick Add while Notepad owned focus, and Cancel closed the overlay without submission."
            );

            session.InvokeByName("Settings");
            session.SetValue(AutomationIds.Hotkey, "Ctrl+Alt+M");
            session.Invoke(AutomationIds.ApplyHotkey);
            _ = await session.WaitForTextAsync(
                AutomationIds.HotkeyStatus,
                text => text.Contains("Registered Ctrl+Alt+M", StringComparison.Ordinal),
                cancellationToken
            );
            session.Focus();
            SendKeys.SendWait("^%m");
            _ = session.WaitForAutomationId(AutomationIds.QuickAddInput, cancellationToken);
            session.InvokeByName("Cancel");

            // The app owns Ctrl+Alt+M from the rebind above, so a competing
            // RegisterHotKey for the same chord returns false and the collision
            // constructor throws, aborting before this assertion is ever recorded.
            // Release the app's registration first, take the chord from the other
            // process, and only then ask the app to re-apply it.
            session.Invoke(AutomationIds.ClearHotkey);
            _ = await session.WaitForTextAsync(
                AutomationIds.HotkeyStatus,
                text => text.Contains("disabled", StringComparison.OrdinalIgnoreCase),
                cancellationToken
            );

            using GlobalHotkeyCollision collisionRegistration = new("Ctrl+Alt+M");
            session.SetValue(AutomationIds.Hotkey, "Ctrl+Alt+M");
            session.Invoke(AutomationIds.ApplyHotkey);
            string collision = await session.WaitForTextAsync(
                AutomationIds.HotkeyStatus,
                text => text.Contains("already used", StringComparison.OrdinalIgnoreCase),
                cancellationToken
            );
            session.Invoke(AutomationIds.ClearHotkey);
            string cleared = await session.WaitForTextAsync(
                AutomationIds.HotkeyStatus,
                text => text.Contains("disabled", StringComparison.OrdinalIgnoreCase),
                cancellationToken
            );
            evidence.Record(
                "hotkey.rebind-collision",
                EvidenceKind.UIA,
                $"Rebound Ctrl+Alt+M invoked Quick Add; a real competing registration reported '{collision}', and Clear reported '{cleared}'."
            );
            notepad.Kill(true);
            await notepad.WaitForExitAsync(cancellationToken);
        }

        private static async Task PackagePersistenceAsync(
            UiAutomationSession session,
            ScenarioConfiguration configuration,
            ScenarioEvidence evidence,
            CancellationToken cancellationToken
        )
        {
            Assert.IsGreaterThan(0, session.Window.Current.ProcessId);
            evidence.Record(
                "package.cold-launch",
                EvidenceKind.UIA,
                "The isolated MSIX identity cold-launched a top-level TaskNotes E2E process and automation window."
            );
            await ConfigureAsync(session, configuration, cancellationToken);
            session.InvokeByName("Browse");
            session.InvokeByName("Toggle task inspector");
            bool inspectorWasOffscreen = session
                .WaitForAutomationId(AutomationIds.EditorTitle, cancellationToken)
                .Current.IsOffscreen;
            System.Windows.Rect before = session.Window.Current.BoundingRectangle;
            await session.RestartAsync(cancellationToken);
            _ = await session.WaitForTextAsync(
                AutomationIds.DestinationTitle,
                text => text.Equals("Browse", StringComparison.Ordinal),
                cancellationToken
            );
            System.Windows.Rect after = session.Window.Current.BoundingRectangle;
            Assert.AreEqual(before.Width, after.Width, 2);
            Assert.AreEqual(before.Height, after.Height, 2);
            evidence.Record(
                "package.restart",
                EvidenceKind.UIA,
                "The packaged process terminated, relaunched, and restored the Browse destination."
            );
            AutomationElement editor = session.WaitForAutomationId(
                AutomationIds.EditorTitle,
                cancellationToken
            );
            Assert.AreEqual(inspectorWasOffscreen, editor.Current.IsOffscreen);
            Assert.IsTrue(Directory.Exists(configuration.AppLocalStateDirectory));
            evidence.Record(
                "window.state-restored",
                EvidenceKind.Persistence,
                $"Window bounds and inspector visibility ({(inspectorWasOffscreen ? "hidden" : "visible")}) survived restart through packaged local settings."
            );
        }

        private static async Task AccessibilityAsync(
            UiAutomationSession session,
            ScenarioConfiguration configuration,
            ScenarioEvidence evidence,
            CancellationToken cancellationToken
        )
        {
            await ConfigureAsync(session, configuration, cancellationToken);
            AutomationElement syncStatus = session.WaitForAutomationId(
                AutomationIds.SyncStatus,
                cancellationToken
            );
            using ManualResetEventSlim announced = new(false);
            AutomationEventHandler handler = (_, _) => announced.Set();
            Automation.AddAutomationEventHandler(
                AutomationElementIdentifiers.LiveRegionChangedEvent,
                syncStatus,
                TreeScope.Element,
                handler
            );
            AutomationElementCollection focusable = session.Window.FindAll(
                TreeScope.Descendants,
                new PropertyCondition(AutomationElement.IsKeyboardFocusableProperty, true)
            );
            Assert.IsGreaterThan(0, focusable.Count);
            foreach (AutomationElement element in focusable)
            {
                string name = element.Current.Name;
                string automationId = element.Current.AutomationId;
                Assert.IsFalse(
                    string.IsNullOrWhiteSpace(name) && string.IsNullOrWhiteSpace(automationId)
                );
            }
            AutomationElement taskList = session.WaitForAutomationId(
                AutomationIds.TaskList,
                cancellationToken
            );
            Assert.AreEqual(ControlType.List, taskList.Current.ControlType);
            Assert.AreEqual(
                true,
                taskList.GetCurrentPropertyValue(
                    AutomationElement.IsSelectionPatternAvailableProperty
                )
            );
            AutomationElement searchValue = session.WaitForAutomationId(
                AutomationIds.Search,
                cancellationToken
            );
            Assert.AreEqual(
                true,
                searchValue.GetCurrentPropertyValue(
                    AutomationElement.IsValuePatternAvailableProperty
                )
            );
            evidence.Record(
                "accessibility.names-roles-values",
                EvidenceKind.UIA,
                "Every focusable element had a name or stable ID; task list and search exposed List/Selection and Value patterns."
            );
            session.Focus();
            SendKeys.SendWait("^f");
            AutomationElement search = session.WaitForAutomationId(
                AutomationIds.Search,
                cancellationToken
            );
            Assert.IsTrue(search.Current.HasKeyboardFocus);
            evidence.Record(
                "keyboard.search-focus",
                EvidenceKind.UIA,
                "Ctrl+F transferred keyboard focus to the search Value-pattern control."
            );
            await PostChaosAsync(configuration, "/__chaos/offline", null, cancellationToken);
            session.InvokeByName("Refresh tasks");
            try
            {
                _ = await session.WaitForTextAsync(
                    AutomationIds.SyncStatus,
                    text => text.Contains("Offline", StringComparison.OrdinalIgnoreCase),
                    cancellationToken
                );
                Assert.IsTrue(announced.Wait(TimeSpan.FromSeconds(5), cancellationToken));
            }
            finally
            {
                Automation.RemoveAutomationEventHandler(
                    AutomationElementIdentifiers.LiveRegionChangedEvent,
                    syncStatus,
                    handler
                );
                await PostChaosAsync(configuration, "/__chaos/online", null, cancellationToken);
            }
            evidence.Record(
                "accessibility.live-status",
                EvidenceKind.UIA,
                "Offline refresh changed the polite live region and raised UIA LiveRegionChanged."
            );
        }

        private static async Task VisualModesAsync(
            UiAutomationSession session,
            ScenarioConfiguration configuration,
            ScenarioEvidence evidence,
            CancellationToken cancellationToken
        )
        {
            await ConfigureAsync(session, configuration, cancellationToken);
            Assert.AreEqual(configuration.VisualVariant, configuration.ActualVisualVariant);
            Assert.AreNotEqual("system", configuration.VisualVariant);
            evidence.Record(
                "visual.profile-match",
                EvidenceKind.System,
                $"The real OS session reported the declared visual profile {configuration.VisualVariant}."
            );
            System.Windows.Rect bounds = session.Window.Current.BoundingRectangle;
            Assert.IsGreaterThan(760, bounds.Width);
            Assert.IsGreaterThan(560, bounds.Height);
            AutomationElementCollection focusable = session.Window.FindAll(
                TreeScope.Descendants,
                new PropertyCondition(AutomationElement.IsKeyboardFocusableProperty, true)
            );
            Assert.IsGreaterThan(0, focusable.Count);
            Assert.IsTrue(
                focusable
                    .Cast<AutomationElement>()
                    .All(element =>
                    {
                        System.Windows.Rect elementBounds = element.Current.BoundingRectangle;
                        return element.Current.IsOffscreen
                            || elementBounds.IsEmpty
                            || bounds.Contains(elementBounds.TopLeft)
                                && bounds.Contains(elementBounds.BottomRight);
                    })
            );
            evidence.Record(
                "visual.usable-bounds",
                EvidenceKind.UIA,
                "Window met minimum size and every onscreen focusable control stayed inside its UIA bounds."
            );
            string screenshot = Path.Combine(
                configuration.ArtifactDirectory,
                $"layout-{configuration.VisualVariant}.png"
            );
            await session.CaptureScreenshotAsync(screenshot, cancellationToken);
            Assert.IsGreaterThan(0, new FileInfo(screenshot).Length);
            evidence.Record(
                "visual.screenshot",
                EvidenceKind.Screenshot,
                $"Captured a non-empty canonical screenshot for {configuration.VisualVariant}."
            );
        }

        private static async Task PostChaosAsync(
            ScenarioConfiguration configuration,
            string route,
            string? body,
            CancellationToken cancellationToken
        )
        {
            using HttpClient client = new();
            using HttpRequestMessage request = new(
                HttpMethod.Post,
                $"{configuration.ProxyUrl}{route}"
            );
            if (body is not null)
            {
                request.Content = new StringContent(body, Encoding.UTF8, "application/json");
            }
            using HttpResponseMessage response = await client.SendAsync(request, cancellationToken);
            _ = response.EnsureSuccessStatusCode();
        }

        private static async Task<string> WaitForVaultAsync(
            ScenarioConfiguration configuration,
            string title,
            bool present,
            CancellationToken cancellationToken
        )
        {
            string tasksDirectory = Path.Combine(configuration.VaultDirectory, "TaskNotes");
            using FileSystemWatcher watcher = new(tasksDirectory, "*.md")
            {
                IncludeSubdirectories = false,
                EnableRaisingEvents = true,
            };
            using AutoResetEvent changed = new(false);
            void HandleFileChanged(object sender, FileSystemEventArgs args)
            {
                _ = changed.Set();
            }

            void HandleFileRenamed(object sender, RenamedEventArgs args)
            {
                _ = changed.Set();
            }

            watcher.Changed += HandleFileChanged;
            watcher.Created += HandleFileChanged;
            watcher.Deleted += HandleFileChanged;
            watcher.Renamed += HandleFileRenamed;
            DateTime deadline = DateTime.UtcNow.AddSeconds(30);
            while (DateTime.UtcNow < deadline)
            {
                cancellationToken.ThrowIfCancellationRequested();
                string? found = Directory
                    .EnumerateFiles(tasksDirectory, "*.md")
                    .Select(File.ReadAllText)
                    .SingleOrDefault(text =>
                        text.Contains($"title: {title}", StringComparison.Ordinal)
                    );
                if ((found is not null) == present)
                {
                    return found ?? string.Empty;
                }
                _ = await Task.Run(
                    () => changed.WaitOne(TimeSpan.FromMilliseconds(250)),
                    cancellationToken
                );
            }
            throw new AssertFailedException(
                $"Vault did not reach expected title state '{title}' present={present}."
            );
        }

        private static async Task<string> WaitForVaultChangeAsync(
            ScenarioConfiguration configuration,
            string title,
            string previous,
            CancellationToken cancellationToken
        )
        {
            string tasksDirectory = Path.Combine(configuration.VaultDirectory, "TaskNotes");
            DateTime deadline = DateTime.UtcNow.AddSeconds(30);
            while (DateTime.UtcNow < deadline)
            {
                cancellationToken.ThrowIfCancellationRequested();
                string? current = Directory
                    .EnumerateFiles(tasksDirectory, "*.md")
                    .Select(File.ReadAllText)
                    .SingleOrDefault(text =>
                        text.Contains($"title: {title}", StringComparison.Ordinal)
                    );
                if (
                    current is not null
                    && !string.Equals(current, previous, StringComparison.Ordinal)
                )
                {
                    return current;
                }
                await Task.Delay(100, cancellationToken);
            }
            throw new AssertFailedException($"Vault task '{title}' did not change.");
        }

        private static async Task WaitForBothMarkdownAsync(
            ScenarioConfiguration configuration,
            string first,
            string second,
            Func<string, bool> predicate,
            CancellationToken cancellationToken
        )
        {
            DateTime deadline = DateTime.UtcNow.AddSeconds(30);
            while (DateTime.UtcNow < deadline)
            {
                string firstText = await WaitForVaultAsync(
                    configuration,
                    first,
                    true,
                    cancellationToken
                );
                string secondText = await WaitForVaultAsync(
                    configuration,
                    second,
                    true,
                    cancellationToken
                );
                if (predicate(firstText) && predicate(secondText))
                {
                    return;
                }
                await Task.Delay(100, cancellationToken);
            }
            throw new AssertFailedException(
                $"Vault tasks '{first}' and '{second}' did not satisfy the expected Markdown predicate."
            );
        }

        private static async Task<string> WaitForFileAsync(
            string path,
            Func<string, bool> predicate,
            CancellationToken cancellationToken
        )
        {
            DateTime deadline = DateTime.UtcNow.AddSeconds(30);
            while (DateTime.UtcNow < deadline)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (File.Exists(path))
                {
                    string text = await File.ReadAllTextAsync(path, cancellationToken);
                    if (predicate(text))
                    {
                        return text;
                    }
                }
                await Task.Delay(100, cancellationToken);
            }
            throw new AssertFailedException($"File '{path}' did not reach the expected state.");
        }

        private static void AssertMarkdownContains(string markdown, params string[] fragments)
        {
            foreach (string fragment in fragments)
            {
                Assert.Contains(fragment, markdown, $"Missing Markdown fragment '{fragment}'.");
            }
        }

        private static string ReadValue(AutomationElement element)
        {
            return
                element.TryGetCurrentPattern(ValuePattern.Pattern, out object pattern)
                && pattern is ValuePattern value
                ? value.Current.Value
                : throw new AssertFailedException(
                    $"'{element.Current.Name}' did not expose the UIA Value pattern."
                );
        }

        private static async Task<JsonDocument> GetServerJsonAsync(
            ScenarioConfiguration configuration,
            string path,
            CancellationToken cancellationToken
        )
        {
            using HttpClient client = new();
            using HttpRequestMessage request = new(
                HttpMethod.Get,
                $"{configuration.ProxyUrl}{path}"
            );
            request.Headers.Authorization = new AuthenticationHeaderValue(
                "Bearer",
                configuration.AuthToken
            );
            using HttpResponseMessage response = await client.SendAsync(request, cancellationToken);
            _ = response.EnsureSuccessStatusCode();
            Stream body = await response.Content.ReadAsStreamAsync(cancellationToken);
            return await JsonDocument.ParseAsync(body, cancellationToken: cancellationToken);
        }

        private static async Task SeedTimeReportTaskAsync(
            ScenarioConfiguration configuration,
            CancellationToken cancellationToken
        )
        {
            DateTimeOffset end = DateTimeOffset.UtcNow.AddMinutes(-1);
            DateTimeOffset start = end.AddMinutes(-10);
            var body = new
            {
                title = "Windows time report seed",
                status = "open",
                priority = "normal",
                tags = new[] { "task", "windows-e2e" },
                projects = Array.Empty<string>(),
                contexts = Array.Empty<string>(),
                timeEntries = new[]
                {
                    new
                    {
                        startTime = start.ToString("O", CultureInfo.InvariantCulture),
                        endTime = end.ToString("O", CultureInfo.InvariantCulture),
                    },
                },
            };
            using HttpClient client = new();
            using HttpRequestMessage request = new(
                HttpMethod.Post,
                $"{configuration.ProxyUrl}/api/tasks"
            );
            request.Headers.Authorization = new AuthenticationHeaderValue(
                "Bearer",
                configuration.AuthToken
            );
            request.Content = new StringContent(
                JsonSerializer.Serialize(body),
                Encoding.UTF8,
                "application/json"
            );
            using HttpResponseMessage response = await client.SendAsync(request, cancellationToken);
            _ = response.EnsureSuccessStatusCode();
        }

        private static async Task AssertTaskTimeStateAsync(
            ScenarioConfiguration configuration,
            string taskId,
            bool expectedActive,
            CancellationToken cancellationToken
        )
        {
            string encoded = Uri.EscapeDataString(taskId);
            using JsonDocument response = await GetServerJsonAsync(
                configuration,
                $"/api/tasks/{encoded}/time",
                cancellationToken
            );
            int active = response
                .RootElement.GetProperty("summary")
                .GetProperty("activeSessions")
                .GetInt32();
            Assert.AreEqual(expectedActive, active > 0);
        }

        private static async Task AssertPomodoroStateAsync(
            ScenarioConfiguration configuration,
            bool expectedActive,
            CancellationToken cancellationToken
        )
        {
            using JsonDocument response = await GetServerJsonAsync(
                configuration,
                "/api/pomodoro/status",
                cancellationToken
            );
            Assert.AreEqual(
                expectedActive,
                response.RootElement.GetProperty("active").GetBoolean()
            );
        }
    }

    internal sealed record ScenarioConfiguration(
        string ScenarioId,
        string PackageFamilyName,
        string ProxyUrl,
        string AuthToken,
        string VaultDirectory,
        string ArtifactDirectory,
        string AppLocalStateDirectory,
        string VisualVariant,
        string ActualVisualVariant,
        IReadOnlySet<string> ExpectedAssertions
    )
    {
        internal static ScenarioConfiguration Load(string expectedScenario)
        {
            string scenario = Required("TASKNOTES_E2E_SCENARIO");
            return !string.Equals(scenario, expectedScenario, StringComparison.Ordinal)
                ? throw new AssertFailedException(
                    $"Expected scenario '{expectedScenario}', received '{scenario}'."
                )
                : new ScenarioConfiguration(
                    scenario,
                    Required("TASKNOTES_E2E_PACKAGE_FAMILY"),
                    Required("TASKNOTES_E2E_PROXY_URL"),
                    Required("TASKNOTES_E2E_AUTH_TOKEN"),
                    Required("TASKNOTES_E2E_VAULT"),
                    Required("TASKNOTES_E2E_ARTIFACTS"),
                    Required("TASKNOTES_E2E_APP_LOCAL_STATE"),
                    Environment.GetEnvironmentVariable("TASKNOTES_E2E_VISUAL_VARIANT") ?? "system",
                    Environment.GetEnvironmentVariable("TASKNOTES_E2E_VISUAL_ACTUAL") ?? "system",
                    ParseAssertions(Required("TASKNOTES_E2E_ASSERTIONS"))
                );
        }

        private static HashSet<string> ParseAssertions(string json)
        {
            string[] values =
                JsonSerializer.Deserialize<string[]>(json)
                ?? throw new InvalidOperationException("E2E assertion JSON was null.");
            HashSet<string> assertions = new(values, StringComparer.Ordinal);
            return assertions.Count == values.Length && assertions.Count > 0
                ? assertions
                : throw new InvalidOperationException(
                    "E2E assertions must be a non-empty set of unique identifiers."
                );
        }

        private static string Required(string name)
        {
            return
                Environment.GetEnvironmentVariable(name) is string value
                && !string.IsNullOrWhiteSpace(value)
                ? value
                : throw new InvalidOperationException(
                    $"{name} is required by the Windows E2E runner."
                );
        }
    }

    internal sealed class ScenarioEvidence
    {
        private static readonly JsonSerializerOptions SerializerOptions = new()
        {
            WriteIndented = true,
        };
        private readonly ScenarioConfiguration _configuration;
        private readonly Dictionary<string, EvidenceObservation> _passed = new(
            StringComparer.Ordinal
        );

        internal ScenarioEvidence(ScenarioConfiguration configuration)
        {
            _configuration = configuration;
        }

        internal void Record(string assertionId, EvidenceKind kind, string observation)
        {
            if (!_configuration.ExpectedAssertions.Contains(assertionId))
            {
                throw new AssertFailedException(
                    $"Scenario '{_configuration.ScenarioId}' emitted undeclared assertion '{assertionId}'."
                );
            }
            if (string.IsNullOrWhiteSpace(observation))
            {
                throw new AssertFailedException(
                    $"Scenario '{_configuration.ScenarioId}' emitted assertion '{assertionId}' without a concrete observation."
                );
            }
            if (
                !_passed.TryAdd(
                    assertionId,
                    new EvidenceObservation(kind, observation, DateTimeOffset.UtcNow)
                )
            )
            {
                throw new AssertFailedException(
                    $"Scenario '{_configuration.ScenarioId}' emitted assertion '{assertionId}' twice."
                );
            }
        }

        internal void AssertComplete()
        {
            string[] missing = _configuration
                .ExpectedAssertions.Except(_passed.Keys, StringComparer.Ordinal)
                .Order(StringComparer.Ordinal)
                .ToArray();
            Assert.HasCount(
                0,
                missing,
                $"Scenario '{_configuration.ScenarioId}' did not produce runtime evidence: {string.Join(", ", missing)}"
            );
        }

        internal async Task WriteAsync(bool completed, CancellationToken cancellationToken)
        {
            string path = Path.Combine(_configuration.ArtifactDirectory, "evidence.json");
            var document = new
            {
                schemaVersion = 1,
                scenario = _configuration.ScenarioId,
                expectedAssertions = _configuration.ExpectedAssertions.Order(
                    StringComparer.Ordinal
                ),
                passedAssertions = _passed
                    .OrderBy(entry => entry.Key, StringComparer.Ordinal)
                    .Select(entry => new
                    {
                        id = entry.Key,
                        kind = EvidenceKindValue(entry.Value.Kind),
                        observation = entry.Value.Observation,
                        recordedAtUtc = entry.Value.RecordedAtUtc,
                    }),
                completed,
                recordedAtUtc = DateTimeOffset.UtcNow,
            };
            await File.WriteAllTextAsync(
                path,
                JsonSerializer.Serialize(document, SerializerOptions),
                cancellationToken
            );
        }

        private static string EvidenceKindValue(EvidenceKind kind)
        {
            return kind switch
            {
                EvidenceKind.UIA => "uia",
                EvidenceKind.Server => "server",
                EvidenceKind.Persistence => "persistence",
                EvidenceKind.Markdown => "markdown",
                EvidenceKind.Screenshot => "screenshot",
                EvidenceKind.System => "system",
                _ => throw new InvalidOperationException($"Unknown evidence kind {kind}."),
            };
        }
    }

    internal enum EvidenceKind
    {
        UIA,
        Server,
        Persistence,
        Markdown,
        Screenshot,
        System,
    }

    internal sealed record EvidenceObservation(
        EvidenceKind Kind,
        string Observation,
        DateTimeOffset RecordedAtUtc
    );

    internal sealed partial class GlobalHotkeyCollision : IDisposable
    {
        private const int HotkeyId = 0x4545;
        private readonly nint _window;
        private bool _disposed;

        internal GlobalHotkeyCollision(string binding)
        {
            (uint modifiers, uint virtualKey) = Parse(binding);
            _window = NativeMethods.CreateWindowEx(
                0,
                "STATIC",
                "TaskNotes E2E hotkey collision",
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0
            );
            if (_window == 0)
            {
                throw new InvalidOperationException(
                    $"Unable to create the collision window. Windows error {Marshal.GetLastPInvokeError()}."
                );
            }
            if (!NativeMethods.RegisterHotKey(_window, HotkeyId, modifiers, virtualKey))
            {
                _ = NativeMethods.DestroyWindow(_window);
                throw new InvalidOperationException(
                    $"Unable to reserve the collision hotkey. Windows error {Marshal.GetLastPInvokeError()}."
                );
            }
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }
            _ = NativeMethods.UnregisterHotKey(_window, HotkeyId);
            _ = NativeMethods.DestroyWindow(_window);
            _disposed = true;
        }

        private static (uint Modifiers, uint VirtualKey) Parse(string binding)
        {
            uint modifiers = 0;
            uint key = 0;
            foreach (
                string component in binding.Split(
                    '+',
                    StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries
                )
            )
            {
                if (component.Equals("Ctrl", StringComparison.OrdinalIgnoreCase))
                {
                    modifiers |= 0x0002;
                }
                else if (component.Equals("Alt", StringComparison.OrdinalIgnoreCase))
                {
                    modifiers |= 0x0001;
                }
                else if (component.Equals("Shift", StringComparison.OrdinalIgnoreCase))
                {
                    modifiers |= 0x0004;
                }
                else if (component.Length == 1 && char.IsAsciiLetterOrDigit(component[0]))
                {
                    key = char.ToUpperInvariant(component[0]);
                }
                else
                {
                    throw new ArgumentException(
                        $"Unsupported collision hotkey component '{component}'.",
                        nameof(binding)
                    );
                }
            }
            return modifiers == 0 || key == 0
                ? throw new ArgumentException("Collision hotkey is incomplete.", nameof(binding))
                : (modifiers, key);
        }

        private static partial class NativeMethods
        {
            [LibraryImport(
                "user32.dll",
                EntryPoint = "CreateWindowExW",
                SetLastError = true,
                StringMarshalling = StringMarshalling.Utf16
            )]
            [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
            internal static partial nint CreateWindowEx(
                uint extendedStyle,
                string className,
                string windowName,
                uint style,
                int x,
                int y,
                int width,
                int height,
                nint parent,
                nint menu,
                nint instance,
                nint parameter
            );

            [LibraryImport("user32.dll", EntryPoint = "DestroyWindow", SetLastError = true)]
            [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
            [return: MarshalAs(UnmanagedType.Bool)]
            internal static partial bool DestroyWindow(nint window);

            [LibraryImport("user32.dll", EntryPoint = "RegisterHotKey", SetLastError = true)]
            [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
            [return: MarshalAs(UnmanagedType.Bool)]
            internal static partial bool RegisterHotKey(
                nint window,
                int id,
                uint modifiers,
                uint virtualKey
            );

            [LibraryImport("user32.dll", EntryPoint = "UnregisterHotKey", SetLastError = true)]
            [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
            [return: MarshalAs(UnmanagedType.Bool)]
            internal static partial bool UnregisterHotKey(nint window, int id);
        }
    }
}
