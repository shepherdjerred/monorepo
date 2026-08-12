using Microsoft.Extensions.Logging.Abstractions;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.Tests
{
    /// <summary>Verifies portable presentation state without WinUI.</summary>
    [TestClass]
    public sealed class PresentationViewModelTests
    {
        /// <summary>Checks fixed, scoped, decoded, and rejected routes.</summary>
        [TestMethod]
        public void NavigationAndActivationRoutesAreStrictAndDecoded()
        {
            NavigationRoute project = NavigationRoute.Parse("project:Windows");
            Assert.AreEqual(PresentationDestination.Tasks, project.Destination);
            Assert.AreEqual(TaskListKind.Project, project.Query?.Kind);
            Assert.AreEqual("Windows", project.Query?.Scope);

            ActivationRoute activation = ActivationRouteParser.Parse(
                new Uri("tasknotes://quick-add?text=Ship+Windows", UriKind.Absolute)
            );
            Assert.AreEqual("quick-add", activation.Action);
            Assert.AreEqual("Ship Windows", activation.Query);

            _ = Assert.ThrowsExactly<ArgumentException>(() => NavigationRoute.Parse("project:"));
            _ = Assert.ThrowsExactly<ArgumentException>(() =>
                ActivationRouteParser.Parse(new Uri("https://example.com", UriKind.Absolute))
            );
        }

        /// <summary>Checks shell routing, command dispatch, and UI-thread snapshot application.</summary>
        [TestMethod]
        public async Task ShellRoutesCommandsAndDispatchesPublishedSnapshots()
        {
            TestTaskNotesStore store = new();
            TestDispatcher dispatcher = new() { HasThreadAccess = false };
            using ShellViewModel viewModel = new(
                store,
                dispatcher,
                NullLogger<ShellViewModel>.Instance
            );

            await viewModel.NavigateAsync("upcoming", TestContext.CancellationToken);
            Assert.AreEqual(TaskListKind.Upcoming, store.LastQuery?.Kind);
            Assert.AreEqual("Upcoming", viewModel.Route.Title);

            TaskItem task = CreateTask("one", "in-progress");
            store.Publish(
                TaskNotesState.Unconfigured with
                {
                    AllTasks = [task],
                    VisibleTasks = [task],
                    SyncState = TaskNotesSyncState.Connected,
                    CanUndoCompletion = true,
                }
            );
            Assert.IsNotNull(dispatcher.Pending);
            dispatcher.RunPending();
            Assert.HasCount(1, viewModel.InProgressBoardTasks);
            Assert.AreEqual(PresentationStatusSeverity.Success, viewModel.StatusSeverity);

            await viewModel.RefreshCommand.ExecuteAsync(null);
            await viewModel.UndoCompletionCommand.ExecuteAsync(null);
            Assert.AreEqual(1, store.RefreshCount);
            Assert.AreEqual(1, store.UndoCount);
        }

        /// <summary>Checks editor dirty tracking, validation, normalization, and full-field persistence.</summary>
        [TestMethod]
        public async Task EditorValidatesNormalizesAndPersistsEveryEditableField()
        {
            TestTaskNotesStore store = new();
            using TaskEditorViewModel editor = new(store, new TestDispatcher());
            editor.Load(CreateTask("task-1", "open"));
            Assert.IsFalse(editor.IsDirty);

            editor.Title = "   ";
            Assert.IsFalse(await editor.SaveAsync(TestContext.CancellationToken));
            Assert.AreEqual("A task title is required.", editor.ValidationError);

            editor.Title = "  Ship Windows  ";
            editor.Details = "  Details  ";
            editor.Projects = "Windows, Windows, Native";
            editor.Contexts = "desk, pc";
            editor.Tags = "quality, test";
            editor.Due = "2026-08-12";
            editor.Scheduled = "2026-08-11";
            editor.Recurrence = "FREQ=DAILY";
            editor.RecurrenceAnchor = "scheduled";
            editor.TimeEstimate = 30;
            Assert.IsTrue(await editor.SaveAsync(TestContext.CancellationToken));

            TaskEditInput edit =
                store.LastEdit ?? throw new AssertFailedException("No edit was recorded.");
            Assert.AreEqual("Ship Windows", edit.Title);
            Assert.AreEqual("Details", edit.Details);
            Assert.AreSequenceEqual(["Windows", "Native"], edit.Projects);
            Assert.AreSequenceEqual(["desk", "pc"], edit.Contexts);
            Assert.AreSequenceEqual(["quality", "test"], edit.Tags);
            Assert.IsFalse(editor.IsDirty);
        }

        /// <summary>Checks Quick Add validation, contextual defaults, and add-another reset behavior.</summary>
        [TestMethod]
        public async Task QuickAddValidatesContextAndSaveAnotherState()
        {
            TestTaskNotesStore store = new()
            {
                Preview = new QuickAddPreview(
                    "Ship Windows",
                    "2026-08-11",
                    "high",
                    ["Windows"],
                    [],
                    ["task"],
                    null
                ),
            };
            QuickAddViewModel viewModel = new(store);
            Assert.IsFalse(await viewModel.PreviewAsync(TestContext.CancellationToken));
            Assert.AreEqual("Enter a task before previewing it.", viewModel.PreviewDescription);

            TaskListQuery context = new(TaskListKind.Project, "Windows");
            viewModel.SetContext(context);
            viewModel.Input = "Ship Windows today !high";
            Assert.IsTrue(await viewModel.PreviewAsync(TestContext.CancellationToken));
            Assert.AreEqual(
                "Ship Windows · due 2026-08-11 · high\nWindows task",
                viewModel.PreviewDescription
            );
            Assert.IsTrue(await viewModel.SaveAsync(true, TestContext.CancellationToken));
            Assert.AreEqual(1, store.AddCount);
            Assert.AreSame(context, store.LastAddContext);
            Assert.AreEqual(string.Empty, viewModel.Input);
            Assert.IsNull(viewModel.Preview);
        }

        /// <summary>Checks URL validation and delayed credential persistence.</summary>
        [TestMethod]
        public async Task SettingsPersistCredentialsOnlyAfterConnectedValidation()
        {
            TestTaskNotesStore store = new();
            TestConfigurationStore configuration = new();
            using SettingsViewModel viewModel = new(store, configuration, new TestDispatcher());
            viewModel.ServerUrl = "not a url";
            Assert.IsFalse(await viewModel.SaveAndSyncAsync(TestContext.CancellationToken));
            Assert.AreEqual(0, configuration.SaveCount);

            store.Reconfigure = (_, _, _) =>
            {
                store.Publish(
                    TaskNotesState.Unconfigured with
                    {
                        SyncState = TaskNotesSyncState.Connected,
                    }
                );
                return Task.CompletedTask;
            };
            viewModel.ServerUrl = "https://tasknotes.example";
            viewModel.Token = "secret";
            Assert.IsTrue(await viewModel.SaveAndSyncAsync(TestContext.CancellationToken));
            Assert.AreEqual(1, configuration.SaveCount);
            Assert.AreEqual("https://tasknotes.example", configuration.ServerUrl);
            Assert.AreEqual("secret", configuration.Token);
        }

        /// <summary>Dispatches settings snapshots on and off the presentation thread.</summary>
        [TestMethod]
        public void SettingsDispatchesStoreStateAndStopsAfterDisposal()
        {
            TestTaskNotesStore store = new();
            TestDispatcher dispatcher = new() { HasThreadAccess = true };
            SettingsViewModel viewModel = new(store, new TestConfigurationStore(), dispatcher);
            ParkedChange parked = new(
                "mutation",
                "Validation",
                "failed",
                422,
                DateTimeOffset.UnixEpoch
            );
            store.Publish(TaskNotesState.Unconfigured with { ParkedChanges = [parked] });
            Assert.HasCount(1, viewModel.State.ParkedChanges);
            Assert.HasCount(1, viewModel.ParkedChanges);

            dispatcher.HasThreadAccess = false;
            store.Publish(TaskNotesState.Unconfigured);
            Assert.IsNotNull(dispatcher.Pending);
            dispatcher.RunPending();
            Assert.HasCount(0, viewModel.ParkedChanges);

            viewModel.Dispose();
            viewModel.Dispose();
            store.Publish(TaskNotesState.Unconfigured with { ParkedChanges = [parked] });
            Assert.IsNull(dispatcher.Pending);
        }

        private static TaskItem CreateTask(string id, string status)
        {
            return new TaskItem(
                id,
                "Task",
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
                string.Empty
            );
        }

        /// <summary>Gets or sets the MSTest execution context.</summary>
        public required TestContext TestContext { get; set; }

        private sealed class TestDispatcher : IUiDispatcher
        {
            internal Action? Pending { get; private set; }

            public bool HasThreadAccess { get; set; }

            public void Enqueue(Action action)
            {
                Pending = action;
            }

            internal void RunPending()
            {
                Action action =
                    Pending
                    ?? throw new InvalidOperationException("No presentation work was queued.");
                Pending = null;
                action();
            }
        }

        private sealed class TestConfigurationStore : IServerConfigurationStore
        {
            internal int SaveCount { get; private set; }
            internal string? ServerUrl { get; private set; }
            internal string? Token { get; private set; }

            public ServerConfiguration Load() => new(ServerUrl, Token);

            public void Save(string serverUrl, string? token)
            {
                SaveCount++;
                ServerUrl = serverUrl;
                Token = token;
            }
        }
    }
}
