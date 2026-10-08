using Microsoft.Extensions.Logging.Abstractions;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.Tests
{
    /// <summary>Verifies portable presentation state without WinUI.</summary>
    [TestClass]
    public sealed class PresentationViewModelTests
    {
        /// <summary>Actual shell presentation excludes foreign owners and drops already queued callbacks after disposal.</summary>
        [TestMethod]
        public void SavedWarningPresentationUsesCompleteOwnerFence()
        {
            TestTaskNotesStore store = new();
            TestDispatcher dispatcher = new() { HasThreadAccess = false };
            using var shell = new ShellViewModel(
                store,
                dispatcher,
                NullLogger<ShellViewModel>.Instance
            );
            var owner = new FacetNoticeOwner("p", "id", 7, 9);
            var notice = new FacetSavedNotice(
                owner,
                ["The task was saved without the configured template."]
            );
            var reading = TaskNotesState.Unconfigured with
            {
                SavedNotice = notice,
                SavedNoticeOwner = owner,
                SavedMaintenance = "Saved. Local cleanup is still pending.",
            };
            store.Publish(reading);
            dispatcher.RunPending();
            Assert.AreSame(notice, shell.SavedNotice);
            Assert.AreEqual(reading.SavedMaintenance, shell.SavedMaintenance);
            foreach (
                var foreign in new[]
                {
                    owner with
                    {
                        ProfileId = "q",
                    },
                    owner with
                    {
                        MutationId = "other",
                    },
                    owner with
                    {
                        RequestGeneration = 8,
                    },
                    owner with
                    {
                        EngineGeneration = 8,
                    },
                }
            )
            {
                store.Publish(reading with { SavedNoticeOwner = foreign });
                dispatcher.RunPending();
                Assert.IsNull(shell.SavedNotice);
            }
            store.Publish(reading with { SavedNoticeOwner = null });
            dispatcher.RunPending();
            Assert.IsNull(shell.SavedNotice);
            var beforeClose = shell.State;
            store.Publish(reading);
            shell.Dispose();
            dispatcher.RunPending();
            Assert.AreSame(beforeClose, shell.State);
        }

        /// <summary>Actual editor await completion cannot replace a newer draft, and own applied observation failure retains it.</summary>
        [TestMethod]
        public async Task NewDraftAndDisposalFenceLateSaveAndSavedObservation()
        {
            foreach (string action in new[] { "new-task", "new-draft", "dispose" })
            {
                TestTaskNotesStore store = new();
                var completion = new TaskCompletionSource(
                    TaskCreationOptions.RunContinuationsAsynchronously
                );
                store.Update = (_, cancellationToken) =>
                    completion.Task.WaitAsync(cancellationToken);
                using var editor = new TaskEditorViewModel(store, new TestDispatcher());
                editor.Load(CreateTask("old", "open"));
                editor.Title = "Submitted";
                var saving = editor.SaveAsync(TestContext.CancellationToken);
                if (action == "new-task")
                    editor.Load(CreateTask("new", "open"));
                else if (action == "new-draft")
                    editor.Title = "New draft";
                else
                    editor.Dispose();
                completion.SetResult();
                Assert.IsTrue(await saving);
                Assert.AreEqual(action == "new-task" ? "new" : "old", editor.TaskId);
                if (action == "new-draft")
                {
                    Assert.AreEqual("New draft", editor.Title);
                    Assert.IsTrue(editor.IsDirty);
                }
            }
            TestTaskNotesStore failed = new()
            {
                Update = (_, _) => Task.FromException(new FacetSavedObservationException()),
            };
            using var retained = new TaskEditorViewModel(failed, new TestDispatcher());
            retained.Load(CreateTask("retained", "open"));
            retained.Title = "Already saved";
            Assert.IsTrue(await retained.SaveAsync(TestContext.CancellationToken));
            Assert.IsTrue(retained.IsDirty);
            Assert.AreEqual("Already saved", retained.Title);
            var report = new TimeReportViewModel(failed);
            await report.LoadSessionsAsync(cancellationToken: TestContext.CancellationToken);
            Assert.IsNull(report.Sessions);
        }

        /// <summary>Typed field controls retain exact values and extensions, freeze workflows, and reject malformed numeric drafts.</summary>
        [TestMethod]
        public async Task TypedEditorFieldsPreserveExtensionsAndValidateOnlyChanges()
        {
            TestTaskNotesStore store = new();
            store.Publish(
                TaskNotesState.Unconfigured with
                {
                    StatusChoices = [new("open", "Original label")],
                    PriorityChoices = [new("normal", "Original priority")],
                }
            );
            var properties =
                System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(
                    """
                    {"timeEstimate":31.625,"completedDate":"2026-10-03","blockedBy":["one"],"completeInstances":["2026-10-03"],"skippedInstances":["2026-10-04"],"attachments":["[[a.pdf]]"],"reminders":[{"id":"original","type":"relative","relatedTo":"due","offset":"-PT15M","vendor":{"exact":9007199254740993}}]}
                    """
                );
            TaskItem task = CreateTask("task", "open") with
            {
                Properties = properties,
                ProfileId = "owner",
                ExpectedRevision = new string('a', 64),
            };
            using TaskEditorViewModel editor = new(store, new TestDispatcher());
            editor.Load(task);
            Assert.AreEqual("31.625", editor.EstimateText);
            Assert.AreEqual("one", editor.BlockedBy);
            Assert.AreEqual("2026-10-03", editor.CompletedDate);
            Assert.AreEqual("2026-10-03", editor.CompleteInstances);
            Assert.AreEqual("2026-10-04", editor.SkippedInstances);
            Assert.AreEqual("[[a.pdf]]", editor.Attachments);
            Assert.IsTrue(editor.Reminders.Single().IsEditable);
            Assert.AreEqual("", editor.Reminders.Single().ExistingValueWarning);
            Assert.HasCount(2, editor.Reminders.Single().TypeChoices);
            Assert.HasCount(2, editor.Reminders.Single().RelatedToChoices);
            store.Publish(
                store.State with
                {
                    StatusChoices = [new("other", "New label")],
                    PriorityChoices = [new("other", "New priority")],
                }
            );
            Assert.AreEqual("Original label", editor.StatusChoices.Single().Label);
            Assert.AreEqual("Original priority", editor.PriorityChoices.Single().Label);
            editor.Details = "Body only";
            Assert.IsTrue(await editor.SaveAsync(TestContext.CancellationToken));
            Assert.IsEmpty(store.LastEdit!.ChangedProperties!);
            Assert.AreEqual("owner", store.LastEdit.ProfileId);
            Assert.AreEqual(task.ExpectedRevision, store.LastEdit.ExpectedRevision);
            editor.Discard();
            Assert.AreEqual(task.Details, editor.Details);
            editor.EstimateText = "";
            editor.BlockedBy = "two, three";
            editor.CompletedDate = "";
            editor.DateCreated = "2026-10-03T10:00:00Z";
            editor.CompleteInstances = "2026-10-05";
            editor.SkippedInstances = "";
            editor.Attachments = "[[a.pdf]]\n[[b.pdf]]";
            var originalRow = editor.Reminders.Single();
            Assert.AreEqual("relative", originalRow.Type);
            originalRow.RelatedTo = "scheduled";
            originalRow.Offset = "-PT30M";
            editor.AddReminder();
            var added = editor.Reminders.Last();
            added.Type = "absolute";
            added.AbsoluteTime = "2026-10-05T10:00:00Z";
            Assert.IsTrue(editor.IsDirty);
            Assert.IsTrue(await editor.SaveAsync(TestContext.CancellationToken));
            var changed = store.LastEdit!.ChangedProperties!;
            Assert.AreEqual(System.Text.Json.JsonValueKind.Null, changed["timeEstimate"].ValueKind);
            Assert.AreEqual(
                System.Text.Json.JsonValueKind.Null,
                changed["completedDate"].ValueKind
            );
            Assert.AreEqual("2026-10-03T10:00:00Z", changed["dateCreated"].GetString());
            Assert.AreEqual("three", changed["blockedBy"][1].GetString());
            Assert.AreEqual(
                "scheduled",
                changed["reminders"][0].GetProperty("relatedTo").GetString()
            );
            Assert.AreEqual(
                "9007199254740993",
                changed["reminders"][0].GetProperty("vendor").GetProperty("exact").GetRawText()
            );
            Assert.AreEqual(added.Id, changed["reminders"][1].GetProperty("id").GetString());
            editor.RemoveReminder(added);
            Assert.HasCount(1, editor.Reminders);
            Assert.IsTrue(editor.IsDirty);
            editor.RemoveReminder(added);
            editor.Reminders.Single().Type = "unsupported";
            _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
                editor.SaveAsync(TestContext.CancellationToken)
            );
            editor.Discard();
            foreach (string invalid in new[] { "not-a-number", "\"20\"", "null", "{}" })
            {
                editor.EstimateText = invalid;
                _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
                    editor.SaveAsync(TestContext.CancellationToken)
                );
                Assert.IsTrue(editor.IsDirty);
            }
            editor.Clear();
            Assert.AreEqual("", editor.Attachments);
            Assert.AreEqual("", editor.CompleteInstances);
            Assert.IsEmpty(editor.Reminders);
            Assert.AreEqual("New label", editor.StatusChoices.Single().Label);
            var opaque = new ReminderEditorRow(
                System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>("42")
            );
            Assert.IsFalse(opaque.IsEditable);
            Assert.AreEqual(
                "Unsupported existing reminder is preserved.",
                opaque.ExistingValueWarning
            );
            var unknown = new ReminderEditorRow(
                System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(
                    "{\"type\":\"vendor\",\"relatedTo\":\"custom\"}"
                )
            );
            Assert.AreEqual("vendor", unknown.TypeChoices[^1].Value);
            Assert.AreEqual("custom", unknown.RelatedToChoices[^1].Value);
        }

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
                string.Empty,
                false
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
