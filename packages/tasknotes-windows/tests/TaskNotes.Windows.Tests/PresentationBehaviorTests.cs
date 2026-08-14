using Microsoft.Extensions.Logging.Abstractions;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.Tests
{
    /// <summary>Covers portable navigation, view state, validation, and auxiliary-window behavior.</summary>
    [TestClass]
    public sealed class PresentationBehaviorTests
    {
        /// <summary>Parses every fixed and scoped shell destination.</summary>
        [TestMethod]
        [DataRow("inbox", TaskListKind.Inbox, PresentationDestination.Tasks)]
        [DataRow("today", TaskListKind.Today, PresentationDestination.Tasks)]
        [DataRow("upcoming", TaskListKind.Upcoming, PresentationDestination.Tasks)]
        [DataRow("browse", TaskListKind.Browse, PresentationDestination.Tasks)]
        [DataRow("completed", TaskListKind.Completed, PresentationDestination.Tasks)]
        [DataRow("board", TaskListKind.Board, PresentationDestination.Board)]
        [DataRow("project:Windows", TaskListKind.Project, PresentationDestination.Tasks)]
        [DataRow("context:desktop", TaskListKind.Context, PresentationDestination.Tasks)]
        [DataRow("tag:quality", TaskListKind.Tag, PresentationDestination.Tasks)]
        [DataRow("saved:one", TaskListKind.SavedView, PresentationDestination.Tasks)]
        public void NavigationParsesEveryTaskDestination(
            string route,
            TaskListKind expectedKind,
            PresentationDestination expectedDestination
        )
        {
            NavigationRoute parsed = NavigationRoute.Parse(route);
            Assert.AreEqual(expectedDestination, parsed.Destination);
            Assert.AreEqual(expectedKind, parsed.Query?.Kind);
        }

        /// <summary>Parses settings and rejects missing, malformed, or unknown scoped routes.</summary>
        [TestMethod]
        public void NavigationHandlesSettingsAndRejectsInvalidRoutes()
        {
            NavigationRoute settings = NavigationRoute.Parse("settings");
            Assert.AreEqual(PresentationDestination.Settings, settings.Destination);
            Assert.IsNull(settings.Query);
            _ = Assert.ThrowsExactly<ArgumentException>(() => NavigationRoute.Parse(string.Empty));
            _ = Assert.ThrowsExactly<ArgumentException>(() => NavigationRoute.Parse("unknown"));
            _ = Assert.ThrowsExactly<ArgumentException>(() => NavigationRoute.Parse("saved:"));
        }

        /// <summary>Parses all supported protocol routes with decoded values and query arguments.</summary>
        [TestMethod]
        [DataRow("tasknotes://inbox", "inbox")]
        [DataRow("tasknotes://today", "today")]
        [DataRow("tasknotes://upcoming", "upcoming")]
        [DataRow("tasknotes://browse", "browse")]
        [DataRow("tasknotes://completed", "completed")]
        [DataRow("tasknotes://kanban", "kanban")]
        [DataRow("tasknotes://settings", "settings")]
        [DataRow("tasknotes://search?q=ship+windows", "search")]
        [DataRow("tasknotes://quick-add?text=ship+windows", "quick-add")]
        [DataRow("tasknotes://pomodoro", "pomodoro")]
        [DataRow("tasknotes://time-report", "time-report")]
        [DataRow("tasknotes://tasks/task%201", "tasks")]
        [DataRow("tasknotes://projects/Windows%20App", "projects")]
        [DataRow("tasknotes://contexts/desktop", "contexts")]
        [DataRow("tasknotes://tags/quality", "tags")]
        [DataRow("tasknotes://saved-views/view%201", "saved-views")]
        // The singular hosts the macOS and iOS clients emit.
        [DataRow("tasknotes://task/Tasks%2Fplan.md", "tasks")]
        [DataRow("tasknotes://project/Website", "projects")]
        [DataRow("tasknotes://context/desktop", "contexts")]
        [DataRow("tasknotes://tag/release", "tags")]
        [DataRow("tasknotes://view/job-search", "saved-views")]
        [DataRow("tasknotes://diagnostics/reset", "diagnostics")]
        public void ActivationParsesEverySupportedRoute(string uri, string expectedAction)
        {
            ActivationRoute route = ActivationRouteParser.Parse(new Uri(uri, UriKind.Absolute));
            Assert.AreEqual(expectedAction, route.Action);
        }

        /// <summary>Rejects entity routes that carry no value and hosts that name no route.</summary>
        [TestMethod]
        [DataRow("tasknotes://task")]
        [DataRow("tasknotes://project")]
        [DataRow("tasknotes://context")]
        [DataRow("tasknotes://tag")]
        [DataRow("tasknotes://view")]
        [DataRow("tasknotes://unsupported")]
        public void ActivationRejectsValuelessEntitiesAndUnknownHosts(string uri)
        {
            _ = Assert.ThrowsExactly<ArgumentException>(() =>
                ActivationRouteParser.Parse(new Uri(uri, UriKind.Absolute))
            );
        }

        /// <summary>Maps every synchronization state to a semantic severity and descriptive status.</summary>
        [TestMethod]
        public void ShellMapsAllSynchronizationStatesAndAppliesDirectDispatch()
        {
            TestTaskNotesStore store = new();
            ImmediateDispatcher dispatcher = new();
            using ShellViewModel shell = new(
                store,
                dispatcher,
                NullLogger<ShellViewModel>.Instance
            );
            Dictionary<TaskNotesSyncState, PresentationStatusSeverity> expectations = new()
            {
                [TaskNotesSyncState.Unconfigured] = PresentationStatusSeverity.Information,
                [TaskNotesSyncState.Loading] = PresentationStatusSeverity.Information,
                [TaskNotesSyncState.Synchronizing] = PresentationStatusSeverity.Information,
                [TaskNotesSyncState.Connected] = PresentationStatusSeverity.Success,
                [TaskNotesSyncState.CachedOffline] = PresentationStatusSeverity.Warning,
                [TaskNotesSyncState.AuthenticationFailure] = PresentationStatusSeverity.Error,
                [TaskNotesSyncState.SynchronizationError] = PresentationStatusSeverity.Error,
            };
            foreach (
                (TaskNotesSyncState state, PresentationStatusSeverity severity) in expectations
            )
            {
                store.Publish(
                    TaskNotesState.Unconfigured with
                    {
                        SyncState = state,
                        PendingCount = 2,
                        ParkedChanges =
                        [
                            new ParkedChange("one", "Api", "failed", 422, DateTimeOffset.UnixEpoch),
                        ],
                        UserFacingError = "detail",
                    }
                );
                Assert.AreEqual(severity, shell.StatusSeverity);
                StringAssert.Contains(shell.StatusMessage, "2 pending", StringComparison.Ordinal);
                StringAssert.Contains(shell.StatusMessage, "1 parked", StringComparison.Ordinal);
                StringAssert.Contains(shell.StatusMessage, "detail", StringComparison.Ordinal);
            }
            Assert.IsTrue(dispatcher.DispatchCount > 0);
        }

        /// <summary>Moves board rows, applies a new query, and stops reacting after disposal.</summary>
        [TestMethod]
        public async Task ShellRoutesBoardCommandsAndStopsAfterDisposal()
        {
            TestTaskNotesStore store = new();
            ImmediateDispatcher dispatcher = new();
            ShellViewModel shell = new(store, dispatcher, NullLogger<ShellViewModel>.Instance);
            TaskItem task = CreateTask("one", "open");
            store.Publish(
                TaskNotesState.Unconfigured with
                {
                    AllTasks = [task],
                    VisibleTasks = [task],
                }
            );
            Assert.HasCount(1, shell.OpenBoardTasks);
            await shell.MoveBoardTaskAsync("one", "done", TestContext.CancellationToken);
            Assert.AreEqual(1, store.SetStatusCount);
            TaskListQuery query = new(TaskListKind.Browse) { Search = "one" };
            await shell.ApplyQueryAsync(query, TestContext.CancellationToken);
            Assert.AreSame(query, store.LastQuery);
            shell.Dispose();
            shell.Dispose();
            store.Publish(TaskNotesState.Unconfigured with { AllTasks = [] });
            Assert.HasCount(1, shell.OpenBoardTasks);
        }

        /// <summary>Restores, deletes, clears, and guards the editor lifecycle.</summary>
        [TestMethod]
        public async Task EditorSupportsDiscardDeleteClearAndLifecycleGuards()
        {
            TestTaskNotesStore store = new();
            using TaskEditorViewModel editor = new(store, new ImmediateDispatcher());
            _ = await Assert.ThrowsExactlyAsync<InvalidOperationException>(async () =>
                await editor.SaveAsync(TestContext.CancellationToken)
            );
            _ = await Assert.ThrowsExactlyAsync<InvalidOperationException>(async () =>
                await editor.DeleteAsync(TestContext.CancellationToken)
            );
            _ = Assert.ThrowsExactly<InvalidOperationException>(editor.Discard);

            editor.Load(CreateTask("one", "open"));
            editor.Title = "changed";
            editor.Discard();
            Assert.AreEqual("Task one", editor.Title);
            await editor.DeleteAsync(TestContext.CancellationToken);
            Assert.AreEqual("one", store.LastDeletedId);
            editor.Clear();
            Assert.IsFalse(editor.IsLoaded);
            Assert.IsNull(editor.TaskId);
            Assert.IsFalse(editor.IsDirty);
        }

        /// <summary>Projects dependency, estimate, and live timing state through the editor.</summary>
        [TestMethod]
        public async Task EditorProjectsTimingDependenciesAndDispatcherLifecycle()
        {
            TestTaskNotesStore store = new();
            ImmediateDispatcher dispatcher = new();
            TaskEditorViewModel editor = new(store, dispatcher);
            _ = await Assert.ThrowsExactlyAsync<InvalidOperationException>(async () =>
                await editor.ToggleTimeAsync(TestContext.CancellationToken)
            );
            _ = await Assert.ThrowsExactlyAsync<InvalidOperationException>(async () =>
                await editor.LoadTimeAsync(TestContext.CancellationToken)
            );
            Assert.IsTrue(double.IsNaN(editor.EstimateValue));
            Assert.AreEqual(string.Empty, editor.TrackedTimeLabel);
            Assert.IsFalse(editor.IsTimerActive);

            TaskItem blocked = new(
                "timed",
                "Timed task",
                null,
                "open",
                "Open",
                "normal",
                "Normal",
                null,
                null,
                null,
                null,
                [],
                [],
                [],
                45,
                12,
                true,
                false,
                false,
                false,
                false,
                null,
                string.Empty,
                true
            );
            editor.Load(blocked);
            Assert.AreEqual(45d, editor.EstimateValue);
            Assert.AreEqual("Blocked by another task", editor.DependencyLabel);
            Assert.AreEqual("Tracked: 12 minutes", editor.TrackedTimeLabel);
            Assert.AreEqual("Stop timer", editor.TimerLabel);
            editor.EstimateValue = 31.6;
            Assert.AreEqual(32u, editor.TimeEstimate);
            editor.EstimateValue = double.NaN;
            Assert.IsNull(editor.TimeEstimate);
            await editor.LoadTimeAsync(TestContext.CancellationToken);

            store.Publish(
                TaskNotesState.Unconfigured with
                {
                    TaskTime = new TaskTimeReading("other", 3, false),
                }
            );
            Assert.IsTrue(editor.IsTimerActive);

            store.Publish(
                TaskNotesState.Unconfigured with
                {
                    TaskTime = new TaskTimeReading("timed", 12, true),
                }
            );
            Assert.IsTrue(editor.IsTimerActive);
            Assert.AreEqual("Stop timer", editor.TimerLabel);
            await editor.ToggleTimeAsync(TestContext.CancellationToken);
            Assert.AreEqual(2, store.TimingCount);

            store.Publish(
                TaskNotesState.Unconfigured with
                {
                    TaskTime = new TaskTimeReading("timed", 12, false),
                }
            );
            Assert.IsFalse(editor.IsTimerActive);
            Assert.AreEqual("Start timer", editor.TimerLabel);
            await editor.ToggleTimeAsync(TestContext.CancellationToken);
            Assert.AreEqual(3, store.TimingCount);
            Assert.IsGreaterThanOrEqualTo(2, dispatcher.DispatchCount);

            int dispatchedOffThread = dispatcher.DispatchCount;
            dispatcher.HasThreadAccess = true;
            store.Publish(
                TaskNotesState.Unconfigured with
                {
                    TaskTime = new TaskTimeReading("timed", 12, true),
                }
            );
            Assert.IsTrue(editor.IsTimerActive);
            Assert.AreEqual(dispatchedOffThread, dispatcher.DispatchCount);
            dispatcher.HasThreadAccess = false;

            TaskItem blocking = new(
                "blocking",
                "Blocking task",
                null,
                "open",
                "Open",
                "normal",
                "Normal",
                null,
                null,
                null,
                null,
                [],
                [],
                [],
                null,
                0,
                false,
                true,
                false,
                false,
                false,
                null,
                string.Empty,
                false
            );
            editor.Load(blocking);
            Assert.AreEqual("Blocking another task", editor.DependencyLabel);
            int dispatchesBeforeDispose = dispatcher.DispatchCount;
            editor.Dispose();
            editor.Dispose();
            store.Publish(TaskNotesState.Unconfigured);
            Assert.AreEqual(dispatchesBeforeDispose, dispatcher.DispatchCount);
        }

        /// <summary>Keeps Quick Add input after ordinary save and validates preview state.</summary>
        [TestMethod]
        public async Task QuickAddOrdinarySaveKeepsInputAndPublishesPreview()
        {
            TestTaskNotesStore store = new()
            {
                Preview = new QuickAddPreview("Preview", null, "normal", [], [], [], null),
            };
            QuickAddViewModel quickAdd = new(store) { Input = "Create task" };
            Assert.IsTrue(await quickAdd.PreviewAsync(TestContext.CancellationToken));
            Assert.IsNotNull(quickAdd.Preview);
            Assert.IsTrue(await quickAdd.SaveAsync(false, TestContext.CancellationToken));
            Assert.AreEqual("Create task", quickAdd.Input);
            Assert.AreEqual(1, store.AddCount);
        }

        /// <summary>Loads configuration, reports connection failure, and delegates parked operations.</summary>
        [TestMethod]
        public async Task SettingsCoversLoadFailureAndParkedCommands()
        {
            TestTaskNotesStore store = new();
            TestConfiguration configuration = new("https://tasks.example", "token");
            using SettingsViewModel settings = new(store, configuration, new ImmediateDispatcher());
            settings.Load();
            Assert.AreEqual("https://tasks.example", settings.ServerUrl);
            Assert.AreEqual("token", settings.Token);
            settings.ServerUrl = "https://offline.example";
            Assert.IsFalse(await settings.SaveAndSyncAsync(TestContext.CancellationToken));
            Assert.AreEqual(
                "TaskNotes could not connect to this server.",
                settings.ValidationError
            );
            await settings.RetryParkedAsync("one", TestContext.CancellationToken);
            await settings.DiscardParkedAsync("one", TestContext.CancellationToken);
            Assert.AreEqual(2, store.ParkedCount);
            settings.Dispose();
            settings.Dispose();
        }

        /// <summary>Projects every live timing and Pomodoro operation from the store snapshot.</summary>
        [TestMethod]
        public async Task AuxiliaryViewModelsRefreshLiveServerState()
        {
            TestTaskNotesStore store = new();
            PomodoroReading pomodoro = new(true, "one", 120, "focus");
            TimeReportReading report = new(30, [new TimeReportRow("one", "Task", 30)]);
            store.State = TaskNotesState.Unconfigured with
            {
                Pomodoro = pomodoro,
                TimeReport = report,
            };
            PomodoroViewModel pomodoroViewModel = new(store);
            await pomodoroViewModel.LoadAsync(TestContext.CancellationToken);
            await pomodoroViewModel.StartAsync("one", TestContext.CancellationToken);
            await pomodoroViewModel.PauseOrResumeAsync(TestContext.CancellationToken);
            await pomodoroViewModel.StopAsync(TestContext.CancellationToken);
            Assert.AreEqual(4, store.PomodoroCount);
            Assert.AreSame(pomodoro, pomodoroViewModel.State);
            TimeReportViewModel timeReport = new(store);
            await timeReport.LoadAsync("week", TestContext.CancellationToken);
            Assert.AreSame(report, timeReport.Report);
            Assert.AreEqual(1, store.TimingCount);
        }

        /// <summary>Projects native global-hotkey success, collision, validation, and disposal.</summary>
        [TestMethod]
        public void GlobalHotkeyStateOwnsThePlatformRegistrar()
        {
            GlobalHotkeyViewModel unattached = new();
            Assert.ThrowsExactly<InvalidOperationException>(() => unattached.Register("Ctrl+N"));

            TestHotkeyRegistrar first = new();
            GlobalHotkeyViewModel hotkey = new();
            hotkey.Attach(first);
            hotkey.Register(" Ctrl+Alt+N ");
            Assert.AreEqual("Ctrl+Alt+N", hotkey.Binding);
            Assert.AreEqual("Registered Ctrl+Alt+N", hotkey.Status);

            first.Registered = false;
            hotkey.Register("Ctrl+Shift+N");
            Assert.Contains("already used", hotkey.Status);
            first.Error = new ArgumentException("invalid binding");
            hotkey.Register("bad");
            Assert.Contains("invalid binding", hotkey.Status);

            TestHotkeyRegistrar second = new();
            hotkey.Attach(second);
            Assert.IsTrue(first.Disposed);
            hotkey.Clear();
            Assert.IsTrue(second.Cleared);
            Assert.AreEqual(string.Empty, hotkey.Binding);
            hotkey.Dispose();
            hotkey.Dispose();
            Assert.IsTrue(second.Disposed);
            Assert.ThrowsExactly<ObjectDisposedException>(() => hotkey.Attach(first));
        }

        private static TaskItem CreateTask(string id, string status)
        {
            return new TaskItem(
                id,
                $"Task {id}",
                null,
                status,
                status,
                "normal",
                "Normal",
                null,
                null,
                null,
                null,
                [],
                [],
                [],
                null,
                0,
                false,
                false,
                status == "done",
                false,
                false,
                null,
                string.Empty,
                false
            );
        }

        /// <summary>Gets or sets the MSTest execution context.</summary>
        public required TestContext TestContext { get; set; }

        private sealed class ImmediateDispatcher : IUiDispatcher
        {
            public bool HasThreadAccess { get; set; }

            internal int DispatchCount { get; private set; }

            public void Enqueue(Action action)
            {
                DispatchCount++;
                action();
            }
        }

        private sealed class TestConfiguration(string? serverUrl, string? token)
            : IServerConfigurationStore
        {
            public ServerConfiguration Load() => new(serverUrl, token);

            public void Save(string savedUrl, string? savedToken)
            {
                serverUrl = savedUrl;
                token = savedToken;
            }
        }

        private sealed class TestHotkeyRegistrar : IGlobalHotkeyRegistrar
        {
            internal bool Registered { get; set; } = true;

            internal ArgumentException? Error { get; set; }

            internal bool Cleared { get; private set; }

            internal bool Disposed { get; private set; }

            public bool Register(string binding)
            {
                _ = binding;
                if (Error is not null)
                {
                    throw Error;
                }
                return Registered;
            }

            public void Clear()
            {
                Cleared = true;
            }

            public void Dispose()
            {
                Disposed = true;
            }
        }
    }
}
