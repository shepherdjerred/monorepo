using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.Tests;

/// <summary>Desktop editing and decoration contracts exercise authoritative revisions and delayed observations.</summary>
[TestClass]
public sealed class DesktopPresentationTests
{
    /// <summary>Every unsent control draft survives another field's delayed receipt, including reminders and advanced metadata.</summary>
    [TestMethod]
    public async Task DelayedTitleReceiptPreservesEveryOtherDirtyField()
    {
        var released = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var store = new ReceiptStore
        {
            Save = async (_, token) =>
            {
                await released.Task.WaitAsync(token);
                return TaskRow("Submitted", "r2");
            },
        };
        using var editor = new TaskEditorViewModel(store, new Dispatcher());
        editor.Load(TaskRow("Original", "r1"));
        Assert.AreEqual("vault", editor.ProfileId);
        editor.Title = "Submitted";
        var saving = editor.CommitFieldAsync("title");
        editor.Status = "waiting";
        editor.Priority = "high";
        editor.Due = "2026-10-12";
        editor.Scheduled = "2026-10-11";
        editor.Recurrence = "FREQ=WEEKLY;BYDAY=MO";
        editor.RecurrenceAnchor = "scheduled";
        editor.Projects = "Alpha, Beta";
        editor.Contexts = "desk, phone";
        editor.Tags = "task, review";
        editor.BlockedBy = "other.md";
        editor.CompletedDate = "2026-10-08T12:00:00Z";
        editor.DateCreated = "2026-10-03T12:00:00Z";
        editor.CompleteInstances = "2026-10-05";
        editor.SkippedInstances = "2026-10-06";
        editor.Attachments = "diagram.png";
        editor.AddReminder();
        released.SetResult();
        Assert.IsTrue(await saving);
        Assert.AreEqual("Submitted", editor.Title);
        Assert.AreSequenceEqual(
            [
                "waiting",
                "high",
                "2026-10-12",
                "2026-10-11",
                "FREQ=WEEKLY;BYDAY=MO",
                "scheduled",
                "Alpha, Beta",
                "desk, phone",
                "task, review",
                "other.md",
                "2026-10-08T12:00:00Z",
                "2026-10-03T12:00:00Z",
                "2026-10-05",
                "2026-10-06",
                "diagram.png",
            ],
            new[]
            {
                editor.Status,
                editor.Priority,
                editor.Due,
                editor.Scheduled,
                editor.Recurrence,
                editor.RecurrenceAnchor,
                editor.Projects,
                editor.Contexts,
                editor.Tags,
                editor.BlockedBy,
                editor.CompletedDate,
                editor.DateCreated,
                editor.CompleteInstances,
                editor.SkippedInstances,
                editor.Attachments,
            }
        );
        Assert.AreSequenceEqual(["Alpha", "Beta"], editor.ProjectsTokens);
        Assert.AreSequenceEqual(["desk", "phone"], editor.ContextsTokens);
        Assert.AreSequenceEqual(["task", "review"], editor.TagsTokens);
        Assert.HasCount(1, editor.Reminders);
        Assert.IsTrue(editor.IsDirty);
        editor.Discard();
        Assert.IsFalse(editor.IsDirty);
        Assert.IsEmpty(editor.Reminders);
        Assert.IsTrue(await editor.SaveAsync());
        _ = Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            editor.CommitFieldAsync("unknown-property")
        );
    }

    /// <summary>Empty copy differentiates authentication, offline cache, errors and query emptiness; grouping keeps native labels.</summary>
    [TestMethod]
    public async Task ShellStatesAndConfiguredPriorityGroupsRemainActionable()
    {
        var store = new TestTaskNotesStore();
        using var shell = new ShellViewModel(
            store,
            new Dispatcher(),
            NullLogger<ShellViewModel>.Instance
        );
        var states = new[]
        {
            (
                TaskNotesSyncState.Unconfigured,
                "Connect your vault",
                "Open Settings to connect Obsidian Sync or select a vault."
            ),
            (
                TaskNotesSyncState.Loading,
                "Loading your tasks…",
                "Reading the saved vault on this device."
            ),
            (
                TaskNotesSyncState.AuthenticationFailure,
                "You’re all caught up",
                "Reconnect your account in Settings. Your saved vault remains on this device."
            ),
            (
                TaskNotesSyncState.CachedOffline,
                "You’re all caught up",
                "You’re viewing the saved vault offline. New changes will sync when connected."
            ),
            (
                TaskNotesSyncState.SynchronizationError,
                "You’re all caught up",
                "Refresh or review recovery actions in Settings."
            ),
            (
                TaskNotesSyncState.Connected,
                "You’re all caught up",
                "Add a task below, or use Ctrl+N for Quick Add."
            ),
        };
        foreach (var (state, title, description) in states)
        {
            store.Publish(
                store.State with
                {
                    SyncState = state,
                    Query = TaskListQuery.Today,
                    UserFacingError = null,
                }
            );
            Assert.AreEqual(title, shell.EmptyTitle);
            Assert.AreEqual(description, shell.EmptyDescription);
        }
        store.Publish(
            store.State with
            {
                UserFacingError = "Review this retained conflict",
                SyncState = TaskNotesSyncState.SynchronizationError,
            }
        );
        Assert.AreEqual("Review this retained conflict", shell.EmptyDescription);
        store.Publish(
            store.State with
            {
                SyncState = TaskNotesSyncState.Connected,
                Query = new TaskListQuery(TaskListKind.Browse) { Search = "missing" },
            }
        );
        Assert.AreEqual("No matching tasks", shell.EmptyTitle);
        Assert.AreEqual("Try a different search or clear the filters.", shell.EmptyDescription);
        store.Publish(store.State with { Query = new TaskListQuery(TaskListKind.Browse) });
        Assert.AreEqual("No tasks here yet", shell.EmptyTitle);
        var task = TaskRow("Grouped", "r1", priority: "review");
        store.Publish(
            store.State with
            {
                VisibleTasks = [task],
                Query = TaskListQuery.Today with { Group = TaskGroupChoice.Priority },
                PriorityChoices = [new("review", "Attention")],
            }
        );
        Assert.AreEqual("1 task", shell.TaskCountLabel);
        Assert.AreEqual("Attention · 1", shell.TaskGroups.Single().Header);
        store.Publish(
            store.State with
            {
                VisibleTasks = [task, TaskRow("Second", "r2", id: "second")],
            }
        );
        Assert.AreEqual("2 tasks", shell.TaskCountLabel);
        Assert.AreEqual("Attention · 2", shell.TaskGroups.Single().Header);
        Assert.AreSame(store.State.SavedViews, shell.SavedViews);
        Assert.AreSame(store.State.ParkedChanges, shell.ParkedChanges);
        await shell.MoveBoardTaskAsync(task, "done");
        Assert.AreEqual(1, store.SetStatusCount);
        store.Publish(store.State with { CanUndoCompletion = true });
        await shell.UndoCompletionCommand.ExecuteAsync(null);
        Assert.AreEqual(1, store.UndoCount);
        await shell.NavigateAsync("settings");
        Assert.AreEqual(store.State.Query, shell.CurrentQuery);
    }

    /// <summary>Compact visible rows retain full accessibility metadata and unsupported-color diagnostics.</summary>
    [TestMethod]
    public void NativeRowAccessibilityRetainsMetadataAndConfiguredDecoration()
    {
        var task = TaskRow("Accessible", "r1", due: "2026-10-09", recurring: true) with
        {
            StatusColor = "unsupported-status",
            PriorityColor = "unsupported-priority",
        };
        var row = new TaskRowPresentation(
            task,
            new TaskListQuery(TaskListKind.Context, "desk"),
            new DateOnly(2026, 10, 8)
        );
        Assert.AreEqual("Tomorrow", row.Date);
        Assert.AreEqual("↻", row.RecurrenceMark);
        Assert.AreEqual("normal", row.Priority);
        Assert.AreEqual("Work · #task", row.Metadata);
        StringAssert.Contains(row.ColorWarning, "unsupported-status", StringComparison.Ordinal);
        StringAssert.Contains(row.ColorWarning, "unsupported-priority", StringComparison.Ordinal);
        foreach (
            string value in new[]
            {
                "Accessible",
                "Awaiting review",
                "normal",
                "Repeats",
                "Due 2026-10-09",
                "Work",
                "#task",
                "unsupported-status",
            }
        )
            StringAssert.Contains(row.AccessibleLabel, value, StringComparison.Ordinal);
        var plain = new TaskRowPresentation(
            TaskRow("Plain", "r2"),
            new TaskListQuery(TaskListKind.Tag, "task"),
            new DateOnly(2026, 10, 8)
        );
        Assert.AreEqual("Work · @desk", plain.Metadata);
        Assert.AreEqual("", plain.RecurrenceMark);
        Assert.AreEqual("", plain.ColorWarning);
    }

    /// <summary>Parsed capture chips and applied-observation failures keep the submitted identity and newer text.</summary>
    [TestMethod]
    public async Task CapturePreviewAndAppliedObservationNeverCreateAReplacement()
    {
        int calls = 0;
        var store = new CaptureStore
        {
            Capture = (_, _, _, admit, _) =>
            {
                calls++;
                admit("applied-capture");
                throw new FacetSavedObservationException();
            },
        };
        store.PreviewOperation = (_, _) =>
            Task.FromResult(
                new QuickAddPreview(
                    "Parsed",
                    "2026-10-12",
                    "high",
                    ["Work"],
                    ["desk"],
                    ["review"],
                    "FREQ=WEEKLY"
                )
            );
        var capture = new QuickAddViewModel(store);
        Assert.IsEmpty(capture.PreviewChips);
        Assert.IsFalse(await capture.SaveAsync(false));
        StringAssert.Contains(capture.ValidationError!, "Enter a task", StringComparison.Ordinal);
        capture.Input = "Parsed #review @desk";
        Assert.IsTrue(await capture.PreviewAsync());
        Assert.AreSequenceEqual(
            ["Due 2026-10-12", "high", "Work", "@desk", "#review", "FREQ=WEEKLY"],
            capture.PreviewChips
        );
        Assert.IsFalse(await capture.SaveAsync(true));
        Assert.IsTrue(capture.NeedsObservation);
        Assert.AreEqual("applied-capture", capture.RecoveryActionId);
        capture.Input = "Newer draft";
        Assert.IsFalse(await capture.SaveAsync(true));
        Assert.AreEqual(1, calls);
        Assert.AreEqual("Newer draft", capture.Input);
    }

    /// <summary>Per-field commits preserve newer buffers while refreshing unrelated externally changed fields.</summary>
    [TestMethod]
    public async Task FieldCommitsRebaseOnlyOnReceiptsAndRetainNewerText()
    {
        var released = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        List<TaskEditInput> submitted = [];
        var store = new ReceiptStore
        {
            Save = async (input, token) =>
            {
                submitted.Add(input);
                if (submitted.Count == 1)
                {
                    await released.Task.WaitAsync(token);
                    return TaskRow("Original", "r2", "high", "2026-10-12");
                }
                if (submitted.Count == 2)
                    return TaskRow("Newer title", "r3", "high", "2026-10-12");
                return TaskRow("Newer title", "r4", "high", "2026-10-12", "Unsent body");
            },
        };
        using var editor = new TaskEditorViewModel(store, new Dispatcher());
        editor.Load(TaskRow("Original", "r1", "normal", "2026-10-10"));
        editor.Priority = "high";
        var first = editor.CommitFieldAsync("priority");
        editor.Title = "Newer title";
        editor.Details = "Unsent body";
        released.SetResult();
        Assert.IsTrue(await first);
        Assert.AreEqual("Newer title", editor.Title);
        Assert.AreEqual("Unsent body", editor.Details);
        Assert.AreEqual("2026-10-12", editor.Due);
        Assert.IsTrue(editor.IsDirty);
        Assert.IsTrue(await editor.CommitFieldAsync("title"));
        Assert.IsTrue(await editor.CommitFieldAsync("body"));
        Assert.AreSequenceEqual(
            ["r1", "r2", "r3"],
            submitted.Select(input => input.ExpectedRevision).ToArray()
        );
        Assert.AreSequenceEqual(["priority"], submitted[0].ChangedProperties!.Keys.ToArray());
        Assert.AreSequenceEqual(["title"], submitted[1].ChangedProperties!.Keys.ToArray());
        Assert.HasCount(0, submitted[2].ChangedProperties!);
        Assert.IsFalse(submitted[0].BodyChanged);
        Assert.IsFalse(submitted[1].BodyChanged);
        Assert.IsTrue(submitted[2].BodyChanged);
        Assert.IsFalse(editor.IsDirty);
    }

    /// <summary>Failure retains the reviewed draft; an applied but unobserved action is never submitted twice.</summary>
    [TestMethod]
    public async Task FailedDraftRetryAndAppliedObservationHaveDifferentOwnership()
    {
        int calls = 0;
        var store = new ReceiptStore
        {
            Save = (input, _) =>
            {
                calls++;
                Assert.AreEqual("r1", input.ExpectedRevision);
                if (calls == 1)
                    throw new ArgumentException("Retained edit failed.");
                return Task.FromResult(TaskRow("Edited", "r2"));
            },
        };
        using var editor = new TaskEditorViewModel(store, new Dispatcher());
        editor.Load(TaskRow("Original", "r1"));
        editor.Title = "Edited";
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            editor.CommitFieldAsync("title")
        );
        Assert.AreEqual("Edited", editor.Title);
        Assert.IsTrue(editor.IsDirty);
        Assert.IsNotNull(editor.CommitError);
        Assert.IsTrue(await editor.CommitFieldAsync("title"));
        Assert.AreEqual(2, calls);
        Assert.IsFalse(editor.IsDirty);

        calls = 0;
        store.Save = (_, _) =>
        {
            calls++;
            throw new FacetSavedObservationException();
        };
        editor.Title = "Applied title";
        Assert.IsTrue(await editor.CommitFieldAsync("title"));
        Assert.IsTrue(editor.NeedsObservation);
        Assert.IsTrue(editor.IsDirty);
        Assert.IsFalse(await editor.SaveAsync());
        Assert.AreEqual(1, calls);
        editor.Discard();
        Assert.IsFalse(editor.IsDirty);
        Assert.IsFalse(editor.NeedsObservation);
    }

    /// <summary>An admitted uncertain edit keeps its exact envelope and newer buffers through Discard/reselection.</summary>
    [TestMethod]
    public async Task AdmittedFailureUsesRecoveryInsteadOfSubmittingAChangedRetry()
    {
        int calls = 0;
        var released = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var store = new ReceiptStore
        {
            Admission = admitted => admitted("owned-action"),
            Save = async (_, token) =>
            {
                calls++;
                await released.Task.WaitAsync(token);
                throw new IOException("Uncertain storage operation.");
            },
        };
        using var editor = new TaskEditorViewModel(store, new Dispatcher());
        editor.Load(TaskRow("Original", "r1"));
        editor.Title = "Submitted";
        var saving = editor.CommitFieldAsync("title");
        store.Publish(
            store.State with
            {
                FacetPendingActions = [new("owned-action", "vault", "Vault", "edit_task")],
            }
        );
        editor.Title = "Newer buffer";
        released.SetResult();
        _ = await Assert.ThrowsExactlyAsync<IOException>(async () =>
            await saving.WaitAsync(CancellationToken.None)
        );
        Assert.AreEqual("owned-action", editor.RecoveryActionId);
        Assert.AreEqual("Newer buffer", editor.Title);
        Assert.IsTrue(editor.IsDirty);
        Assert.IsFalse(await editor.SaveAsync());
        Assert.AreEqual(1, calls);
        editor.Discard();
        Assert.IsFalse(editor.IsDirty);
        Assert.AreEqual("owned-action", editor.RecoveryActionId);
        Assert.IsFalse(await editor.SaveAsync());
        Assert.AreEqual(1, calls);
        store.Publish(
            store.State with
            {
                FacetPendingActions = [],
                AllTasks = [TaskRow("Submitted", "r2")],
            }
        );
        editor.Load(store.State.AllTasks.Single());
        Assert.IsNull(editor.RecoveryActionId);
        Assert.AreEqual("Submitted", editor.Title);
    }

    /// <summary>Queued old-owner edits and late observation errors cannot cross selection or disposal.</summary>
    [TestMethod]
    public async Task QueuedFieldsNeverCrossTaskSelectionOrDisposal()
    {
        foreach (bool dispose in new[] { false, true })
        {
            var released = new TaskCompletionSource(
                TaskCreationOptions.RunContinuationsAsynchronously
            );
            int calls = 0;
            var store = new ReceiptStore
            {
                Admission = admitted => admitted("old-action"),
                Save = async (_, token) =>
                {
                    calls++;
                    await released.Task.WaitAsync(token);
                    throw new FacetSavedObservationException();
                },
            };
            using var editor = new TaskEditorViewModel(store, new Dispatcher());
            editor.Load(TaskRow("Original", "r1"));
            editor.Title = "Offered";
            var first = editor.CommitFieldAsync("title");
            store.Publish(
                store.State with
                {
                    FacetPendingActions = [new("old-action", "vault", "Vault", "edit_task")],
                }
            );
            editor.Priority = "high";
            var queued = editor.CommitFieldAsync("priority");
            if (dispose)
                editor.Dispose();
            else
                editor.Load(TaskRow("Other", "other-r1", id: "other"));
            released.SetResult();
            Assert.IsTrue(await first);
            Assert.IsFalse(await queued);
            Assert.AreEqual(1, calls);
            Assert.IsFalse(editor.NeedsObservation);
            Assert.IsNull(editor.RecoveryActionId);
            if (!dispose)
                Assert.AreEqual("Other", editor.Title);
        }
    }

    /// <summary>Configured colors follow shared CSS RGBA policy and never replace open taxonomy values.</summary>
    [TestMethod]
    public void ColorsAndTaxonomySuggestionsRetainConfiguredValues()
    {
        Assert.AreEqual(new ConfiguredColor(255, 0, 0, 255), ConfiguredColor.Parse(" ReD "));
        Assert.AreEqual(new ConfiguredColor(17, 34, 51, 68), ConfiguredColor.Parse("#1234"));
        Assert.AreEqual(new ConfiguredColor(17, 34, 51, 68), ConfiguredColor.Parse("#11223344"));
        Assert.AreEqual(new ConfiguredColor(17, 34, 51, 255), ConfiguredColor.Parse("#123"));
        Assert.AreEqual(new ConfiguredColor(17, 34, 51, 255), ConfiguredColor.Parse("#112233"));
        Assert.AreEqual(new ConfiguredColor(0, 0, 0, 0), ConfiguredColor.Parse("transparent"));
        Assert.IsNull(ConfiguredColor.Parse("var(--brand)"));
        Assert.IsNull(ConfiguredColor.Parse("#12"));
        Assert.IsNull(ConfiguredColor.Parse("#ghijkl"));
        Assert.AreEqual("", ConfiguredColor.Diagnostic(null));
        var store = new TestTaskNotesStore();
        store.Publish(
            store.State with
            {
                StatusChoices = [new("review", "Needs review") { Color = "var(--brand)" }],
                PriorityChoices = [new("normal", "Normal") { Color = "unsupported-priority" }],
                Projects = ["Work", "Workshop", "Home"],
                Contexts = ["desk", "desktop", "phone"],
                Tags = ["task", "review", "release"],
            }
        );
        using var editor = new TaskEditorViewModel(store, new Dispatcher());
        editor.Load(TaskRow("Original", "r1"));
        editor.Status = "review";
        Assert.AreEqual("review", editor.Status);
        Assert.Contains("var(--brand)", editor.StatusColorWarning);
        Assert.Contains("unsupported-priority", editor.PriorityColorWarning);
        Assert.AreSequenceEqual(["Workshop"], editor.TokenSuggestions("projects", "Work, wo"));
        Assert.AreSequenceEqual(["desktop"], editor.TokenSuggestions("contexts", "desk, des"));
        Assert.AreSequenceEqual(["release"], editor.TokenSuggestions("tags", "review, re"));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            editor.TokenSuggestions("unknown", "")
        );
    }

    /// <summary>Grouping uses open configured values; date labels never guess ambiguous provenance.</summary>
    [TestMethod]
    public void GroupsAndDateDecorationsPreserveCoreSemantics()
    {
        var task = TaskRow("Original", "r1", due: "2026-10-10") with
        {
            EffectiveDate = "2026-10-09",
            HasCoreEffectiveDate = true,
        };
        var row = new TaskRowPresentation(task, TaskListQuery.Today, new DateOnly(2026, 10, 8));
        Assert.AreEqual("Tomorrow", row.Date);
        Assert.AreEqual("Date 2026-10-09", row.DateDescription);
        Assert.AreEqual(
            "Due 2026-10-10",
            new TaskRowPresentation(
                TaskRow("Date", "r1", due: "2026-10-10"),
                TaskListQuery.Today,
                new DateOnly(2026, 10, 8)
            ).DateDescription
        );
        var coincident = TaskRow("Both", "r1", due: "2026-10-10", scheduled: "2026-10-10");
        Assert.AreEqual(
            "Date 2026-10-10",
            new TaskRowPresentation(
                coincident,
                TaskListQuery.Today,
                new DateOnly(2026, 10, 8)
            ).DateDescription
        );
        var offset = TaskRow(
            "Offset",
            "r1",
            due: "2026-10-10T00:30:00+14:00",
            scheduled: "2026-10-09"
        ) with
        {
            EffectiveDate = "2026-10-09",
            HasCoreEffectiveDate = true,
        };
        Assert.AreEqual(
            "Date 2026-10-09",
            new TaskRowPresentation(
                offset,
                TaskListQuery.Today,
                new DateOnly(2026, 10, 8)
            ).DateDescription
        );
        Assert.AreEqual(
            "",
            new TaskRowPresentation(
                task with
                {
                    EffectiveDate = null,
                },
                TaskListQuery.Today,
                new DateOnly(2026, 10, 8)
            ).Date
        );
        var store = new TestTaskNotesStore
        {
            State = TaskNotesState.Unconfigured with
            {
                VisibleTasks = [task],
                Query = new TaskListQuery(TaskListKind.Project, "Work")
                {
                    Group = TaskGroupChoice.Status,
                },
                StatusChoices = [new("review", "Awaiting review")],
            },
        };
        using var shell = new ShellViewModel(
            store,
            new Dispatcher(),
            NullLogger<ShellViewModel>.Instance
        );
        Assert.AreEqual("Awaiting review · 1", shell.TaskGroups.Single().Header);
        Assert.AreEqual("@desk · #task", shell.TaskGroups.Single().Single().Metadata);
        Assert.AreEqual("1 task", shell.TaskCountLabel);
    }

    /// <summary>Missing, unknown and altered roles fail validation at the shared boundary.</summary>
    [TestMethod]
    public void SharedPresentationRolesAreStrictlyValidated()
    {
        string Read(string name)
        {
            using var stream = typeof(PresentationTokens).Assembly.GetManifestResourceStream(name)!;
            using var reader = new StreamReader(stream);
            return reader.ReadToEnd();
        }
        string schema = Read("PresentationSchema.json");
        string json = Read("PresentationTokens.json");
        var tokens = PresentationTokens.Bundled();
        Assert.AreEqual(340, tokens.Number("desktop", "inspector", "ideal"));
        Assert.AreEqual(74, tokens.Number("desktop", "dateColumnMin"));
        Assert.Contains("separator", tokens.ColorRoles);
        foreach (string kind in new[] { "missing", "unknown", "altered" })
        {
            var changed = JsonNode.Parse(json)!;
            var spacing = changed["spacing"]!.AsObject();
            if (kind == "missing")
                spacing.Remove("md");
            else if (kind == "unknown")
                spacing.Add("extra", 5);
            else
                spacing["md"] = 13;
            _ = Assert.ThrowsExactly<InvalidDataException>(() =>
                new PresentationTokens(changed.ToJsonString(), schema)
            );
        }
    }

    /// <summary>Late preview results and saved capture resets cannot erase a newer draft or change its context.</summary>
    [TestMethod]
    public async Task CaptureSubmissionFreezesInputAndContextWithoutErasingNewDraft()
    {
        var released = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        List<(string Input, TaskListQuery Context)> offers = [];
        var store = new TestTaskNotesStore
        {
            AddOperation = async (input, context, token) =>
            {
                offers.Add((input, context));
                await released.Task.WaitAsync(token);
            },
        };
        var capture = new QuickAddViewModel(store) { Input = "First #task" };
        capture.SetContext(new TaskListQuery(TaskListKind.Project, "First"));
        var first = capture.SaveAsync(true);
        capture.Input = "Second @desk";
        capture.SetContext(new TaskListQuery(TaskListKind.Context, "desk"));
        var second = capture.SaveAsync(true);
        Assert.IsFalse(await second);
        released.SetResult();
        Assert.IsTrue(await first);
        Assert.AreEqual("Second @desk", capture.Input);
        Assert.IsTrue(await capture.SaveAsync(true));
        Assert.AreSequenceEqual(
            ["First #task", "Second @desk"],
            offers.Select(offer => offer.Input).ToArray()
        );
        Assert.AreSequenceEqual(
            ["First", "desk"],
            offers.Select(offer => offer.Context.Scope).ToArray()
        );
        Assert.AreEqual("", capture.Input);
        Assert.IsFalse(capture.IsSubmitting);
        var stale = new TaskCompletionSource<QuickAddPreview>(
            TaskCreationOptions.RunContinuationsAsynchronously
        );
        store.PreviewOperation = (_, token) => stale.Task.WaitAsync(token);
        capture.Input = "Old preview";
        var preview = capture.PreviewAsync();
        capture.Input = "New input";
        stale.SetResult(new QuickAddPreview("Old", null, "normal", [], [], [], null));
        Assert.IsFalse(await preview);
        Assert.IsNull(capture.Preview);
    }

    /// <summary>Capture admission is immediate, vault-qualified, and uncertain creates cannot be replaced by changed text.</summary>
    [TestMethod]
    public async Task CaptureAdmissionRejectsDuplicateAndRetainsExactUncertainAction()
    {
        var released = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        int calls = 0;
        var store = new CaptureStore
        {
            Capture = async (_, _, profile, admit, token) =>
            {
                calls++;
                Assert.AreEqual("vault", profile);
                admit("capture-action");
                await released.Task.WaitAsync(token);
                throw new IOException("Uncertain capture");
            },
        };
        var capture = new QuickAddViewModel(store) { Input = "Submitted" };
        var first = capture.SaveAsync(true);
        Assert.IsTrue(capture.IsSubmitting);
        Assert.IsFalse(capture.CanSubmit);
        Assert.IsFalse(await capture.SaveAsync(true));
        capture.Input = "Newer text";
        store.Publish(
            store.State with
            {
                FacetPendingActions = [new("capture-action", "vault", "Vault", "create")],
            }
        );
        released.SetResult();
        _ = await Assert.ThrowsExactlyAsync<IOException>(async () =>
            await first.WaitAsync(CancellationToken.None)
        );
        Assert.AreEqual(1, calls);
        Assert.AreEqual("capture-action", capture.RecoveryActionId);
        Assert.AreEqual("Newer text", capture.Input);
        Assert.IsFalse(await capture.SaveAsync(true));
        Assert.IsFalse(capture.DiscardDraft());
        store.Publish(store.State with { FacetPendingActions = [] });
        Assert.IsTrue(capture.DiscardDraft());
        Assert.AreEqual("", capture.Input);

        var preview = new TaskCompletionSource<QuickAddPreview>(
            TaskCreationOptions.RunContinuationsAsynchronously
        );
        store.PreviewOperation = (_, token) => preview.Task.WaitAsync(token);
        store.Capture = (_, _, profile, _, _) =>
        {
            Assert.AreEqual("vault", profile);
            if (store.SelectedProfileId != profile)
                throw new ArgumentException("Owning vault changed");
            Assert.Fail("A changed vault must reject this capture before admission.");
            return Task.CompletedTask;
        };
        capture.Input = "Vault-owned draft";
        var switched = capture.SaveAsync(false);
        store.SelectedProfileId = "other";
        preview.SetResult(
            new QuickAddPreview("Vault-owned draft", null, "normal", [], [], [], null)
        );
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(async () =>
            await switched.WaitAsync(CancellationToken.None)
        );
        Assert.IsNull(capture.RecoveryActionId);
        Assert.AreEqual("Vault-owned draft", capture.Input);
    }

    private sealed class CaptureStore : TestTaskNotesStore, IFacetCaptureStore
    {
        public string? SelectedProfileId { get; set; } = "vault";
        internal required Func<
            string,
            TaskListQuery,
            string?,
            Action<string>,
            CancellationToken,
            Task
        > Capture { get; set; }

        public Task AddCaptureAsync(
            string input,
            TaskListQuery context,
            string? profile,
            Action<string> actionAdmitted,
            CancellationToken cancellationToken = default
        ) => Capture(input, context, profile, actionAdmitted, cancellationToken);
    }

    private static TaskItem TaskRow(
        string title,
        string revision,
        string priority = "normal",
        string? due = null,
        string? body = null,
        string? scheduled = null,
        string id = "task",
        bool recurring = false
    ) =>
        new TaskItem(
            id,
            title,
            body,
            "review",
            "Awaiting review",
            priority,
            priority,
            due,
            scheduled,
            recurring ? "FREQ=DAILY" : null,
            null,
            ["Work"],
            ["desk"],
            ["task"],
            false,
            false,
            false,
            recurring,
            false,
            null,
            "review"
        )
        {
            ProfileId = "vault",
            ExpectedRevision = revision,
            VaultPath = id,
        };

    private sealed class Dispatcher : IUiDispatcher
    {
        public bool HasThreadAccess => true;

        public void Enqueue(Action action) => action();
    }

    private sealed class ReceiptStore : TestTaskNotesStore, IFacetTaskEditorStore
    {
        internal Action<Action<string>>? Admission { get; set; }
        internal required Func<TaskEditInput, CancellationToken, Task<TaskItem>> Save { get; set; }

        public Task<TaskItem> SaveTaskEditAsync(
            TaskEditInput input,
            CancellationToken cancellationToken = default
        ) => Save(input, cancellationToken);

        public Task<TaskItem> SaveTaskEditAsync(
            TaskEditInput input,
            Action<string> actionAdmitted,
            CancellationToken cancellationToken = default
        )
        {
            Admission?.Invoke(actionAdmitted);
            return Save(input, cancellationToken);
        }
    }
}
