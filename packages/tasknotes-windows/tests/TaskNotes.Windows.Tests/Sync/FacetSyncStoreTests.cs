using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using TaskNotes.Protocol;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;
using ProtocolTask = TaskNotes.Protocol.Task;
using Task = System.Threading.Tasks.Task;

namespace TaskNotes.Windows.Tests;

/// <summary>Covers FacetSyncStore optimistic mutations, queries, board columns, saved views, reminders, feedback, and undo.</summary>
[TestClass]
public sealed class FacetSyncStoreTests
{
    /// <summary>Gets or sets the MSTest execution context.</summary>
    public required TestContext TestContext { get; set; }

    /// <summary>Hydrates from SQLite and transitions across Unconfigured, Connected, CachedOffline, AuthFailure, and ServerSwitch.</summary>
    [TestMethod]
    public async Task InitializeReconfigureAndServerSwitchManageLifecycleStates()
    {
        ManualClock clock = new();
        RecordingHttpHandler handler = new();
        using HttpClient http = new(handler);
        using TemporaryDirectory directory = new();

        await using FacetSyncStore store = new(directory.Path, http, clock);
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        Assert.AreEqual(TaskNotesSyncState.Unconfigured, store.State.SyncState);

        Project inbox = ProtocolTestFactory.MakeProject("proj-inbox", "Inbox", isInbox: true);
        ProtocolTask seededTask = ProtocolTestFactory.MakeTask(
            "task-1",
            "proj-inbox",
            "Seeded",
            dueDate: "2026-10-08"
        );
        handler.Responder = (_, _) =>
            Task.FromResult(
                RecordingHttpHandler.JsonResponse(
                    HttpStatusCode.OK,
                    JsonSerializer.Serialize(
                        ProtocolTestFactory.EmptySyncResponse(
                            syncToken: "seq:5",
                            fullSync: true,
                            projects: [inbox],
                            tasks: [seededTask]
                        ),
                        FacetProtocolJson.Options
                    )
                )
            );

        await store.ReconfigureAsync("https://one.example", "tok-1", TestContext.CancellationToken);
        Assert.AreEqual(TaskNotesSyncState.Connected, store.State.SyncState);
        Assert.HasCount(1, store.State.TodayTasks);

        handler.Responder = static (_, _) => throw new HttpRequestException("offline");
        await store.RefreshAsync(TestContext.CancellationToken);
        Assert.AreEqual(TaskNotesSyncState.CachedOffline, store.State.SyncState);
        Assert.HasCount(1, store.State.TodayTasks);

        handler.Responder = static (_, _) =>
            Task.FromResult(
                RecordingHttpHandler.JsonResponse(
                    HttpStatusCode.Unauthorized,
                    """{"error":"Token expired"}"""
                )
            );
        await store.RefreshAsync(TestContext.CancellationToken);
        Assert.AreEqual(TaskNotesSyncState.AuthenticationFailure, store.State.SyncState);
        Assert.AreEqual("Token expired", store.State.UserFacingError);

        handler.Responder = static (_, _) =>
            Task.FromResult(
                RecordingHttpHandler.JsonResponse(
                    HttpStatusCode.BadGateway,
                    """{"error":"Gateway timeout"}"""
                )
            );
        await store.RefreshAsync(TestContext.CancellationToken);
        Assert.AreEqual(TaskNotesSyncState.SynchronizationError, store.State.SyncState);

        handler.Responder = static (_, _) =>
            Task.FromResult(
                RecordingHttpHandler.JsonResponse(
                    HttpStatusCode.OK,
                    JsonSerializer.Serialize(
                        ProtocolTestFactory.EmptySyncResponse(syncToken: "seq:1", fullSync: true),
                        FacetProtocolJson.Options
                    )
                )
            );
        await store.InitializeAsync("https://two.example", "tok-2", TestContext.CancellationToken);
        Assert.AreEqual(TaskNotesSyncState.Connected, store.State.SyncState);
        Assert.IsEmpty(store.State.AllTasks);
    }

    /// <summary>Exercises capture, task edits with empty-string clears, reminders, recurring undo, and feedback ownership.</summary>
    [TestMethod]
    public async Task CaptureEditsRemindersRecurringCompletionAndUndoMaintainProtocolInvariants()
    {
        ManualClock clock = new();
        RecordingHttpHandler handler = new();
        using HttpClient http = new(handler);
        using FacetSqliteCache cache = FacetSqliteCache.OpenSharedMemory();
        using FacetApiClient api = new(http, ownsClient: false);
        await using FacetSyncStore store = new(
            cache,
            api,
            clock,
            autoSyncOnMutate: false,
            ownsCache: false,
            ownsClient: false
        );

        FacetFeedbackScene scene = new();
        scene.SetForeground(true);
        store.FeedbackScene = scene;
        List<FacetAppliedFeedback> feedbacks = [];
        store.AppliedFeedback += feedbacks.Add;

        QuickAddPreview preview = await store.PreviewQuickAddAsync(
            "Ship #Core @fast tomorrow p1 daily",
            TestContext.CancellationToken
        );
        Assert.AreEqual("Ship", preview.Title);
        Assert.AreEqual("2026-10-09", preview.Due);

        FacetPreparedCapture prepared = await store.PrepareCaptureAsync(
            "Ship #Core @fast today p1 daily",
            TaskListQuery.Today,
            store.SelectedProfileId,
            new FacetCaptureOptions(Body: new FacetCaptureField<string>("Initial body"))
            {
                FeedbackLease = scene.Capture(),
            },
            TestContext.CancellationToken
        );
        string? admittedId = null;
        await store.SubmitPreparedCaptureAsync(
            prepared,
            id => admittedId = id,
            TestContext.CancellationToken
        );
        Assert.IsNotNull(admittedId);
        Assert.HasCount(1, feedbacks);
        Assert.AreEqual("created", feedbacks[0].Event);
        Assert.IsTrue(store.OwnsFeedback(feedbacks[0]));

        TaskItem created = store.State.AllTasks.Single();
        Assert.AreEqual("Ship", created.Title);
        Assert.AreEqual("Initial body", created.Details);
        Assert.AreEqual("2026-10-08", created.Due);
        Assert.AreEqual("FREQ=DAILY", created.Recurrence);
        Assert.AreSequenceEqual(["Core"], created.Projects);
        Assert.AreSequenceEqual(["fast"], created.Tags);

        JsonElement withReminders = JsonSerializer.Deserialize<JsonElement>(
            """{"reminders":[{"id":"tmp-r1","type":"relative","relatedTo":"due","offset":"-PT30M"},{"id":"tmp-r2","type":"absolute","absoluteTime":"2026-10-09T09:00:00Z"}]}"""
        );
        TaskItem edited = await store.SaveTaskEditAsync(
            new TaskEditInput
            {
                Id = created.Id,
                Title = "Ship v2",
                Details = "Updated body",
                Status = "open",
                Priority = "p2",
                Due = "2026-10-10",
                Recurrence = "FREQ=DAILY",
                Projects = ["Core", "Extra"],
                Tags = ["fast", "newtag"],
                ChangedProperties = new Dictionary<string, JsonElement>(StringComparer.Ordinal)
                {
                    ["reminders"] = withReminders.GetProperty("reminders"),
                },
                BodyChanged = true,
            },
            TestContext.CancellationToken
        );
        Assert.AreEqual("Ship v2", edited.Title);
        Assert.HasCount(2, store.State.ScheduledReminders);

        JsonElement oneUpdatedReminder = JsonSerializer.Deserialize<JsonElement>(
            """{"reminders":[{"id":"tmp-r1","type":"relative","relatedTo":"due","offset":"-PT15M"}]}"""
        );
        TaskItem clearedDates = await store.SaveTaskEditAsync(
            new TaskEditInput
            {
                Id = edited.Id,
                Title = "Ship v2",
                Details = "Updated body",
                Status = "open",
                Priority = "p2",
                Projects = ["Core"],
                Tags = ["fast"],
                ChangedProperties = new Dictionary<string, JsonElement>(StringComparer.Ordinal)
                {
                    ["reminders"] = oneUpdatedReminder.GetProperty("reminders"),
                },
            },
            TestContext.CancellationToken
        );
        Assert.IsNull(clearedDates.Due);
        Assert.IsNull(clearedDates.Recurrence);

        SyncCommand.TaskUpdate clearPatch = cache
            .ReadSnapshot()
            .Outbox.Select(q => q.Command)
            .OfType<SyncCommand.TaskUpdate>()
            .Last();
        Assert.AreEqual(string.Empty, clearPatch.Args.DueDate);
        Assert.AreEqual(string.Empty, clearPatch.Args.RecurrenceRule);

        _ = await store.SaveTaskEditAsync(
            new TaskEditInput
            {
                Id = edited.Id,
                Title = "Daily Standup",
                Status = "open",
                Priority = "p1",
                Due = "2026-10-08",
                Recurrence = "FREQ=DAILY",
                Projects = ["Core"],
            },
            TestContext.CancellationToken
        );
        await store.SetCompletionAsync(edited.Id, true, TestContext.CancellationToken);
        TaskItem advanced = store.State.AllTasks.Single();
        Assert.IsFalse(advanced.IsCompleted);
        Assert.AreEqual("2026-10-09", advanced.Due);
        Assert.IsTrue(store.State.CanUndoCompletion);
        FacetAppliedFeedback completedFeedback = feedbacks.Last();
        Assert.IsTrue(store.CanUndoOutcome(completedFeedback));

        await store.UndoCurrentSavedAsync(
            completedFeedback.Owner.MutationId,
            TestContext.CancellationToken
        );
        TaskItem undone = store.State.AllTasks.Single();
        Assert.AreEqual("2026-10-08", undone.Due);
        Assert.IsFalse(store.State.CanUndoCompletion);

        DependencyEditorMetadata depMeta = await store.ReadDependencyEditorMetadataAsync(
            "default",
            TestContext.CancellationToken
        );
        Assert.Contains("FINISHTOSTART", depMeta.RelationshipTypes);
    }

    /// <summary>Covers Todoist Board columns (Project sections vs cross-project priorities), Saved Views, bulk actions, and queries.</summary>
    [TestMethod]
    public async Task BoardColumnsSavedViewsBulkMutationsAndQueriesProjectCorrectly()
    {
        ManualClock clock = new();
        RecordingHttpHandler handler = new();
        using HttpClient http = new(handler);
        using FacetSqliteCache cache = FacetSqliteCache.OpenSharedMemory();
        using FacetApiClient api = new(http, ownsClient: false);
        await using FacetSyncStore store = new(
            cache,
            api,
            clock,
            autoSyncOnMutate: false,
            ownsCache: false,
            ownsClient: false
        );

        string projId = await store.CreateProjectAsync(
            "Platform",
            "#246FE0",
            true,
            TestContext.CancellationToken
        );
        string secBacklog = await store.CreateSectionAsync(
            projId,
            "Backlog",
            1,
            TestContext.CancellationToken
        );
        string secActive = await store.CreateSectionAsync(
            projId,
            "Active",
            2,
            TestContext.CancellationToken
        );
        _ = await store.CreateLabelAsync("infra", "#EB8909", TestContext.CancellationToken);

        await store.AddAsync(
            "Migrate DB #Platform @infra today p1",
            TaskListQuery.Today,
            TestContext.CancellationToken
        );
        await store.AddAsync(
            "Write docs #Platform 2026-10-12 p3",
            TaskListQuery.Today,
            TestContext.CancellationToken
        );
        await store.AddAsync(
            "Inbox errand",
            new TaskListQuery(TaskListKind.Inbox),
            TestContext.CancellationToken
        );

        await store.SetQueryAsync(
            new TaskListQuery(TaskListKind.Board),
            TestContext.CancellationToken
        );
        Assert.AreSequenceEqual(
            ["p1", "p2", "p3", "p4"],
            store.State.BoardColumns.Select(c => c.Value).ToArray()
        );
        string migrateId = store.State.AllTasks.First(t => t.Title == "Migrate DB").Id;
        await store.MoveTaskToBoardColumnAsync(migrateId, "p2", 3, TestContext.CancellationToken);
        Assert.AreEqual("p2", store.State.AllTasks.First(t => t.Id == migrateId).Priority);

        await store.SetQueryAsync(
            new TaskListQuery(TaskListKind.Project, "Platform"),
            TestContext.CancellationToken
        );
        Assert.AreSequenceEqual(
            [FacetSyncStore.NoSectionColumnValue, secBacklog, secActive],
            store.State.BoardColumns.Select(c => c.Value).ToArray()
        );

        using (
            ShellViewModel shell = new(
                store,
                new DirectDispatcher(),
                NullLogger<ShellViewModel>.Instance
            )
        )
        {
            TaskItem card = store.State.VisibleTasks.First(t => t.Id == migrateId);
            await shell.MoveBoardTaskAsync(card, secActive, TestContext.CancellationToken);
        }
        Assert.HasCount(1, store.State.BoardColumns.Single(c => c.Value == secActive).Tasks);
        await store.SetStatusAsync(
            migrateId,
            FacetSyncStore.NoSectionColumnValue,
            TestContext.CancellationToken
        );
        Assert.IsEmpty(store.State.BoardColumns.Single(c => c.Value == secActive).Tasks);

        SavedViewDefinition createdView = await store.CreateSavedViewAsync(
            "Platform High",
            "Filter",
            "blue",
            true,
            new TaskListQuery(TaskListKind.Browse)
            {
                Projects = ["Platform"],
                Sort = TaskSortChoice.Title,
                Group = TaskGroupChoice.Priority,
            },
            TestContext.CancellationToken
        );
        SavedViewDefinition duplicatedView = await store.DuplicateSavedViewAsync(
            createdView.Id,
            TestContext.CancellationToken
        );
        Assert.HasCount(2, store.State.SavedViews);
        await store.UpdateSavedViewAsync(
            createdView with
            {
                Name = "Platform Focus",
            },
            TestContext.CancellationToken
        );
        await store.MoveSavedViewAsync(duplicatedView.Id, 0, TestContext.CancellationToken);
        Assert.AreEqual(duplicatedView.Id, store.State.SavedViews[0].Id);

        await store.SetQueryAsync(
            new TaskListQuery(TaskListKind.SavedView, createdView.Id),
            TestContext.CancellationToken
        );
        Assert.HasCount(2, store.State.VisibleTasks);

        await store.DeleteSavedViewAsync(duplicatedView.Id, TestContext.CancellationToken);
        await store.RestoreDefaultSavedViewsAsync(TestContext.CancellationToken);
        Assert.IsGreaterThanOrEqualTo(3, store.State.SavedViews.Count);

        foreach (
            TaskListQuery query in new[]
            {
                new TaskListQuery(TaskListKind.Inbox),
                TaskListQuery.Today,
                new TaskListQuery(TaskListKind.Upcoming) { Group = TaskGroupChoice.Date },
                new TaskListQuery(TaskListKind.Tag, "infra") { Group = TaskGroupChoice.Project },
                new TaskListQuery(TaskListKind.Context, "infra") { Group = TaskGroupChoice.Status },
                new TaskListQuery(TaskListKind.Browse)
                {
                    Search = "docs",
                    Sort = TaskSortChoice.DueDate,
                    Descending = true,
                },
                new TaskListQuery(TaskListKind.Browse)
                {
                    HasNoDueDate = true,
                    Sort = TaskSortChoice.Priority,
                },
            }
        )
        {
            await store.SetQueryAsync(query, TestContext.CancellationToken);
        }

        string docsId = store.State.AllTasks.First(t => t.Title == "Write docs").Id;
        await store.ScheduleTasksAsync([docsId], "2026-10-15", TestContext.CancellationToken);
        await store.PrioritizeTasksAsync([docsId], "p1", TestContext.CancellationToken);
        await store.CompleteTasksAsync([docsId], TestContext.CancellationToken);
        await store.SetQueryAsync(
            new TaskListQuery(TaskListKind.Completed),
            TestContext.CancellationToken
        );
        Assert.HasCount(1, store.State.VisibleTasks);
        await store.UndoCompletionAsync(TestContext.CancellationToken);
        await store.DeleteTasksAsync([docsId], TestContext.CancellationToken);
        await store.DeleteTaskAsync(migrateId, TestContext.CancellationToken);
        Assert.HasCount(1, store.State.AllTasks);
    }

    /// <summary>Covers validation guards, filter/sort/group branches, plain-string filters, and parked-mutation store operations.</summary>
    [TestMethod]
    public async Task ValidationGuardsFilterCombinationsAndParkedStoreActionsCoverEdgeBranches()
    {
        ManualClock clock = new();
        RecordingHttpHandler handler = new();
        using HttpClient http = new(handler);
        using FacetSqliteCache cache = FacetSqliteCache.OpenSharedMemory();
        using FacetApiClient api = new(http, ownsClient: false);
        await using FacetSyncStore store = new(
            cache,
            api,
            clock,
            autoSyncOnMutate: false,
            ownsCache: false,
            ownsClient: false
        );

        _ = await Assert.ThrowsExactlyAsync<FacetValidationException>(() =>
            store.CreateProjectAsync(" ", null, false, TestContext.CancellationToken)
        );
        string pA = await store.CreateProjectAsync(
            "Alpha",
            null,
            false,
            TestContext.CancellationToken
        );
        string pB = await store.CreateProjectAsync(
            "Beta",
            null,
            false,
            TestContext.CancellationToken
        );
        _ = await Assert.ThrowsExactlyAsync<FacetValidationException>(() =>
            store.CreateSectionAsync(pA, " ", null, TestContext.CancellationToken)
        );
        string secB = await store.CreateSectionAsync(
            pB,
            "CrossSec",
            null,
            TestContext.CancellationToken
        );
        _ = await Assert.ThrowsExactlyAsync<FacetValidationException>(() =>
            store.CreateLabelAsync(" ", null, TestContext.CancellationToken)
        );
        _ = await Assert.ThrowsExactlyAsync<FacetValidationException>(() =>
            store.CreateSavedViewAsync(
                " ",
                "Filter",
                "blue",
                false,
                TaskListQuery.Today,
                TestContext.CancellationToken
            )
        );
        _ = await Assert.ThrowsExactlyAsync<InvalidOperationException>(() =>
            store.UndoCompletionAsync(TestContext.CancellationToken)
        );
        _ = await Assert.ThrowsExactlyAsync<FacetValidationException>(() =>
            store.UndoCurrentSavedAsync("missing-receipt", TestContext.CancellationToken)
        );
        _ = await Assert.ThrowsExactlyAsync<FacetValidationException>(() =>
            store.ScheduleTasksAsync(["x"], "not-a-date", TestContext.CancellationToken)
        );

        await store.DeleteTasksAsync([], TestContext.CancellationToken);
        await store.CompleteTasksAsync([], TestContext.CancellationToken);
        await store.ScheduleTasksAsync([], null, TestContext.CancellationToken);
        await store.PrioritizeTasksAsync([], "p1", TestContext.CancellationToken);

        FacetPreparedCapture prepared = await store.PrepareCaptureAsync(
            "Overdue task #Alpha @ops 2026-10-01 p2",
            TaskListQuery.Today,
            store.SelectedProfileId,
            new FacetCaptureOptions(),
            TestContext.CancellationToken
        );
        await store.SubmitPreparedCaptureAsync(prepared, _ => { }, TestContext.CancellationToken);
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            store.SubmitPreparedCaptureAsync(prepared, _ => { }, TestContext.CancellationToken)
        );

        await store.AddAsync(
            "Tomorrow task #Alpha @ops 2026-10-09 p1",
            TaskListQuery.Today,
            TestContext.CancellationToken
        );
        await store.AddAsync(
            "Future task #Beta 2026-10-20 p4",
            TaskListQuery.Today,
            TestContext.CancellationToken
        );
        await store.AddAsync(
            "Undated task #Alpha",
            new TaskListQuery(TaskListKind.Browse),
            TestContext.CancellationToken
        );

        string taskId = store.State.AllTasks.First(t => t.Title == "Overdue task").Id;
        _ = await Assert.ThrowsExactlyAsync<FacetValidationException>(() =>
            store.SaveTaskEditAsync(
                new TaskEditInput
                {
                    Id = taskId,
                    Title = "  ",
                    Status = "open",
                    Priority = "p2",
                },
                TestContext.CancellationToken
            )
        );

        string? editAdmitted = null;
        _ = await store.SaveTaskEditAsync(
            new TaskEditInput
            {
                Id = taskId,
                Title = "Overdue task",
                Status = "done",
                Priority = "p2",
                SectionId = secB,
                ParentId = "",
                Projects = ["Alpha"],
                Tags = ["ops"],
            },
            id => editAdmitted = id,
            TestContext.CancellationToken
        );
        Assert.IsNotNull(editAdmitted);

        _ = await store.SaveTaskEditAsync(
            new TaskEditInput
            {
                Id = taskId,
                Title = "Overdue task",
                Status = "open",
                Priority = "p2",
                SectionId = secB,
                Projects = ["Alpha"],
                Tags = ["ops"],
            },
            TestContext.CancellationToken
        );

        await store.MoveTaskToBoardColumnAsync(taskId, "done", null, TestContext.CancellationToken);
        await store.MoveTaskToBoardColumnAsync(taskId, "open", null, TestContext.CancellationToken);
        await store.MoveTaskToBoardColumnAsync(taskId, secB, null, TestContext.CancellationToken);
        await store.MoveTaskToBoardColumnAsync(taskId, "", null, TestContext.CancellationToken);

        cache.EnqueueAndApply(
            [
                new QueuedCommand(
                    "flt-plain-1",
                    "flt-1",
                    new SyncCommand.FilterAdd(
                        new FilterAddArgs(Name: "PlainP1", Query: "p1 #Alpha @ops")
                    )
                ),
                new QueuedCommand(
                    "flt-plain-2",
                    "flt-2",
                    new SyncCommand.FilterAdd(new FilterAddArgs(Name: "PlainToday", Query: "today"))
                ),
            ],
            clock.GetUtcNow()
        );
        cache.ApplySyncResponse(
            ProtocolTestFactory.EmptySyncResponse(
                syncToken: "seq:9",
                fullSync: false,
                syncStatus: new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["flt-plain-1"] = "error: Filter rejected",
                }
            ),
            new HashSet<string>(["flt-plain-1"], StringComparer.Ordinal),
            clock.GetUtcNow(),
            "https://facet.example"
        );

        await store.RetryParkedMutationAsync("flt-plain-1", TestContext.CancellationToken);
        Assert.IsEmpty(store.State.ParkedChanges);

        foreach (
            TaskListQuery q in new[]
            {
                new TaskListQuery(TaskListKind.SavedView, "flt-1"),
                new TaskListQuery(TaskListKind.SavedView, "flt-2"),
                new TaskListQuery(TaskListKind.Browse)
                {
                    Statuses = ["open"],
                    Priorities = ["p1", "p2"],
                    Projects = ["Alpha", "Beta"],
                    Tags = ["ops"],
                    Sort = TaskSortChoice.DueDate,
                    Descending = false,
                    Group = TaskGroupChoice.Date,
                },
                new TaskListQuery(TaskListKind.Browse)
                {
                    Sort = TaskSortChoice.Priority,
                    Descending = true,
                    Group = TaskGroupChoice.Priority,
                },
                new TaskListQuery(TaskListKind.Browse)
                {
                    Sort = TaskSortChoice.Title,
                    Descending = true,
                },
                new TaskListQuery(TaskListKind.Browse)
                {
                    Sort = TaskSortChoice.AsSynchronized,
                    Descending = true,
                },
            }
        )
        {
            await store.SetQueryAsync(q, TestContext.CancellationToken);
        }
    }

    private sealed class DirectDispatcher : IUiDispatcher
    {
        public bool HasThreadAccess => true;

        public void Enqueue(Action action) => action();
    }
}
