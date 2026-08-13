using System.Globalization;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests
{
    /// <summary>Covers store mutation, projection, saved-view, undo, and lifecycle branches.</summary>
    [TestClass]
    public sealed class TaskNotesStoreBehaviorTests
    {
        /// <summary>Updates every field, performs bulk mutations, and removes duplicate identifiers once.</summary>
        [TestMethod]
        public async Task CompleteMutationSurfacePersistsThroughTheCore()
        {
            using TemporaryDirectory directory = new();
            await using TaskNotesStore store = new(directory.Path);
            await store.InitializeAsync(null, null, TestContext.CancellationToken);
            TaskListQuery project = new(TaskListKind.Project, "[[Windows]]");
            await store.AddAsync("Ship native app", project, TestContext.CancellationToken);
            TaskItem created = store.State.AllTasks.Single();
            await store.UpdateTaskAsync(
                new TaskEditInput
                {
                    Id = created.Id,
                    Title = "  Ship native Windows app  ",
                    Details = "Markdown details",
                    Status = "waiting",
                    Priority = "high",
                    Due = "2026-08-20",
                    Scheduled = "2026-08-19",
                    Recurrence = "FREQ=DAILY",
                    RecurrenceAnchor = "scheduled",
                    Projects = ["[[Windows]]", "[[Native]]", "[[Native]]"],
                    Contexts = ["desktop", "desk", "desktop"],
                    Tags = ["quality", "native", "quality"],
                    TimeEstimate = 45,
                },
                TestContext.CancellationToken
            );

            TaskItem updated = store.State.AllTasks.Single();
            Assert.AreEqual("Ship native Windows app", updated.Title);
            Assert.AreEqual("Markdown details", updated.Details);
            Assert.AreEqual("waiting", updated.Status);
            Assert.AreEqual("high", updated.Priority);
            Assert.AreEqual("2026-08-20", updated.Due);
            Assert.AreEqual("2026-08-19", updated.Scheduled);
            Assert.AreEqual("FREQ=DAILY", updated.Recurrence);
            Assert.AreEqual("scheduled", updated.RecurrenceAnchor);
            Assert.AreSequenceEqual(["[[Windows]]", "[[Native]]"], updated.Projects);
            Assert.AreSequenceEqual(["desktop", "desk"], updated.Contexts);
            Assert.AreSequenceEqual(["quality", "native"], updated.Tags);
            Assert.AreEqual(45u, updated.TimeEstimate);

            await store.ScheduleTasksAsync(
                [updated.Id, updated.Id],
                null,
                TestContext.CancellationToken
            );
            await store.PrioritizeTasksAsync(
                [updated.Id, updated.Id],
                "low",
                TestContext.CancellationToken
            );
            await store.SetStatusAsync(updated.Id, "in-progress", TestContext.CancellationToken);
            TaskItem bulkUpdated = store.State.AllTasks.Single();
            Assert.IsNull(bulkUpdated.Scheduled);
            Assert.AreEqual("low", bulkUpdated.Priority);
            Assert.AreEqual("in-progress", bulkUpdated.Status);

            await store.DeleteTasksAsync([updated.Id, updated.Id], TestContext.CancellationToken);
            Assert.IsEmpty(store.State.AllTasks);
        }

        /// <summary>Deletes one task and refreshes or reconfigures an unconfigured cache safely.</summary>
        [TestMethod]
        public async Task SingleDeleteRefreshAndReconfigurePublishSnapshots()
        {
            using TemporaryDirectory directory = new();
            await using TaskNotesStore store = new(directory.Path);
            await store.InitializeAsync(null, null, TestContext.CancellationToken);
            await store.RefreshAsync(TestContext.CancellationToken);
            Assert.AreEqual(TaskNotesSyncState.Unconfigured, store.State.SyncState);
            await store.AddAsync("Delete one", TestContext.CancellationToken);
            string id = store.State.AllTasks.Single().Id;
            await store.DeleteTaskAsync(id, TestContext.CancellationToken);
            Assert.IsEmpty(store.State.AllTasks);
            await store.ReconfigureAsync(null, null, TestContext.CancellationToken);
            Assert.AreEqual(TaskNotesSyncState.Unconfigured, store.State.SyncState);
        }

        /// <summary>Exercises every destination, filter dimension, sort, and grouping projection.</summary>
        [TestMethod]
        public async Task QueryProjectionCoversAllScopesFiltersSortsAndGroups()
        {
            using TemporaryDirectory directory = new();
            await using TaskNotesStore store = new(directory.Path);
            await store.InitializeAsync(null, null, TestContext.CancellationToken);
            await store.AddAsync(
                "Zulu project",
                new TaskListQuery(TaskListKind.Project, "[[Windows]]"),
                TestContext.CancellationToken
            );
            await store.AddAsync(
                "Alpha context",
                new TaskListQuery(TaskListKind.Context, "desktop"),
                TestContext.CancellationToken
            );
            await store.AddAsync(
                "Middle tag",
                new TaskListQuery(TaskListKind.Tag, "quality"),
                TestContext.CancellationToken
            );
            await store.AddAsync(
                "Plain inbox",
                new TaskListQuery(TaskListKind.Inbox),
                TestContext.CancellationToken
            );

            await AssertQueryTitlesAsync(
                store,
                new TaskListQuery(TaskListKind.Project, "[[Windows]]"),
                "Zulu project"
            );
            await AssertQueryTitlesAsync(
                store,
                new TaskListQuery(TaskListKind.Context, "desktop"),
                "Alpha context"
            );
            await AssertQueryTitlesAsync(
                store,
                new TaskListQuery(TaskListKind.Tag, "quality"),
                "Middle tag"
            );
            await AssertQueryTitlesAsync(
                store,
                new TaskListQuery(TaskListKind.Inbox),
                "Middle tag",
                "Plain inbox"
            );
            await AssertQueryTitlesAsync(
                store,
                new TaskListQuery(TaskListKind.Browse) { Search = "alpha" },
                "Alpha context"
            );
            await AssertQueryTitlesAsync(
                store,
                new TaskListQuery(TaskListKind.Browse) { Projects = ["[[Windows]]"] },
                "Zulu project"
            );
            await AssertQueryTitlesAsync(
                store,
                new TaskListQuery(TaskListKind.Browse) { Contexts = ["desktop"] },
                "Alpha context"
            );
            await AssertQueryTitlesAsync(
                store,
                new TaskListQuery(TaskListKind.Browse) { Tags = ["quality"] },
                "Middle tag"
            );
            await AssertQueryTitlesAsync(
                store,
                new TaskListQuery(TaskListKind.Browse) { Priorities = ["normal"] },
                "Zulu project",
                "Alpha context",
                "Middle tag",
                "Plain inbox"
            );
            await AssertQueryTitlesAsync(
                store,
                new TaskListQuery(TaskListKind.Browse) { Statuses = ["open"] },
                "Zulu project",
                "Alpha context",
                "Middle tag",
                "Plain inbox"
            );
            await AssertQueryTitlesAsync(
                store,
                new TaskListQuery(TaskListKind.Browse) { HasNoDueDate = true },
                "Zulu project",
                "Alpha context",
                "Middle tag",
                "Plain inbox"
            );

            foreach (TaskSortChoice sort in Enum.GetValues<TaskSortChoice>())
            {
                await store.SetQueryAsync(
                    new TaskListQuery(TaskListKind.Browse) { Sort = sort, Descending = true },
                    TestContext.CancellationToken
                );
                Assert.HasCount(4, store.State.VisibleTasks);
            }
            foreach (TaskGroupChoice group in Enum.GetValues<TaskGroupChoice>())
            {
                await store.SetQueryAsync(
                    new TaskListQuery(TaskListKind.Browse) { Group = group },
                    TestContext.CancellationToken
                );
                Assert.HasCount(4, store.State.VisibleTasks);
            }

            await store.SetCompletionAsync(
                store.State.AllTasks.Single(task => task.Title == "Plain inbox").Id,
                true,
                TestContext.CancellationToken
            );
            await AssertQueryTitlesAsync(
                store,
                new TaskListQuery(TaskListKind.Completed),
                "Plain inbox"
            );
            await store.SetQueryAsync(
                new TaskListQuery(TaskListKind.Upcoming),
                TestContext.CancellationToken
            );
            await store.SetQueryAsync(
                new TaskListQuery(TaskListKind.Today),
                TestContext.CancellationToken
            );
            await store.SetQueryAsync(
                new TaskListQuery(TaskListKind.Board),
                TestContext.CancellationToken
            );
        }

        /// <summary>Handles no-op completion, recurring completion, bounded undo, and empty undo.</summary>
        [TestMethod]
        public async Task CompletionUndoHandlesNoOpsRecurringTasksAndEmptyStack()
        {
            using TemporaryDirectory directory = new();
            await using TaskNotesStore store = new(directory.Path);
            await store.InitializeAsync(null, null, TestContext.CancellationToken);
            await store.UndoCompletionAsync(TestContext.CancellationToken);
            Assert.AreEqual(0, store.State.CompletionUndoDepth);
            await store.AddAsync("Daily review", TestContext.CancellationToken);
            TaskItem recurring = store.State.AllTasks.Single();
            await store.UpdateTaskAsync(
                new TaskEditInput
                {
                    Id = recurring.Id,
                    Title = recurring.Title,
                    Details = recurring.Details,
                    Status = recurring.Status,
                    Priority = recurring.Priority,
                    Due = recurring.Due,
                    Scheduled = recurring.Due,
                    Recurrence = "FREQ=DAILY",
                    RecurrenceAnchor = "scheduled",
                    Projects = recurring.Projects,
                    Contexts = recurring.Contexts,
                    Tags = recurring.Tags,
                    TimeEstimate = recurring.TimeEstimate,
                },
                TestContext.CancellationToken
            );
            recurring = store.State.AllTasks.Single();
            Assert.IsTrue(recurring.IsRecurring);
            await store.SetCompletionAsync(recurring.Id, true, TestContext.CancellationToken);
            Assert.AreEqual(1, store.State.CompletionUndoDepth);
            await store.SetCompletionAsync(recurring.Id, true, TestContext.CancellationToken);
            Assert.AreEqual(1, store.State.CompletionUndoDepth);
            await store.UndoCompletionAsync(TestContext.CancellationToken);
            Assert.AreEqual(0, store.State.CompletionUndoDepth);
            Assert.IsFalse(store.State.AllTasks.Single().IsCompleted);
        }

        /// <summary>Restores defaults and validates saved-view not-found and active-deletion branches.</summary>
        [TestMethod]
        public async Task SavedViewsCoverDefaultsMoveBoundsAndNotFoundFailures()
        {
            using TemporaryDirectory directory = new();
            await using TaskNotesStore store = new(directory.Path);
            await store.InitializeAsync(null, null, TestContext.CancellationToken);
            Assert.HasCount(2, store.State.SavedViews);
            SavedViewDefinition first = store.State.SavedViews[0];
            await store.MoveSavedViewAsync(first.Id, int.MaxValue, TestContext.CancellationToken);
            Assert.AreEqual(first.Id, store.State.SavedViews[^1].Id);
            await store.SetQueryAsync(
                new TaskListQuery(TaskListKind.SavedView, first.Id),
                TestContext.CancellationToken
            );
            await store.DeleteSavedViewAsync(first.Id, TestContext.CancellationToken);
            Assert.AreEqual(TaskListKind.Browse, store.State.Query.Kind);
            await store.RestoreDefaultSavedViewsAsync(TestContext.CancellationToken);
            Assert.HasCount(2, store.State.SavedViews);

            _ = await Assert.ThrowsExactlyAsync<uniffi.TaskNotesCore.CoreException.NotFound>(
                async () =>
                    await store.DuplicateSavedViewAsync("missing", TestContext.CancellationToken)
            );
            _ = await Assert.ThrowsExactlyAsync<uniffi.TaskNotesCore.CoreException.NotFound>(
                async () =>
                    await store.DeleteSavedViewAsync("missing", TestContext.CancellationToken)
            );
            _ = await Assert.ThrowsExactlyAsync<uniffi.TaskNotesCore.CoreException.NotFound>(
                async () =>
                    await store.UpdateSavedViewAsync(
                        first with
                        {
                            Id = "missing",
                        },
                        TestContext.CancellationToken
                    )
            );
        }

        /// <summary>Rejects invalid arguments and every operation after disposal without hiding contract failures.</summary>
        [TestMethod]
        public async Task StoreLifecycleAndBoundaryValidationFailLoudly()
        {
            using TemporaryDirectory directory = new();
            TaskNotesStore store = new(directory.Path);
            _ = await Assert.ThrowsExactlyAsync<uniffi.TaskNotesCore.CoreException.Validation>(
                async () =>
                    await store.InitializeAsync(null, "token", TestContext.CancellationToken)
            );
            await store.InitializeAsync(null, null, TestContext.CancellationToken);
            _ = await Assert.ThrowsExactlyAsync<ArgumentException>(async () =>
                await store.AddAsync(string.Empty, TestContext.CancellationToken)
            );
            _ = await Assert.ThrowsExactlyAsync<ArgumentException>(async () =>
                await store.SetStatusAsync(string.Empty, "open", TestContext.CancellationToken)
            );
            _ = await Assert.ThrowsExactlyAsync<ArgumentException>(async () =>
                await store.SetStatusAsync("missing", string.Empty, TestContext.CancellationToken)
            );
            uint pendingBefore = store.State.PendingCount;
            await store.SetStatusAsync("missing.md", "open", TestContext.CancellationToken);
            Assert.AreEqual(pendingBefore + 1, store.State.PendingCount);
            _ = await Assert.ThrowsExactlyAsync<uniffi.TaskNotesCore.CoreException.Validation>(
                async () =>
                    await store.SetQueryAsync(
                        new TaskListQuery(TaskListKind.Project),
                        TestContext.CancellationToken
                    )
            );
            Assert.AreEqual(TaskListKind.Today, store.State.Query.Kind);
            _ = await Assert.ThrowsExactlyAsync<uniffi.TaskNotesCore.CoreException.Validation>(
                async () =>
                    await store.LoadPomodoroAsync(TestContext.CancellationToken)
            );
            await store.DisposeAsync();
            await store.DisposeAsync();
            _ = await Assert.ThrowsExactlyAsync<ObjectDisposedException>(async () =>
                await store.RefreshAsync(TestContext.CancellationToken)
            );
        }

        /// <summary>Serializes concurrent mutations without corrupting immutable snapshots.</summary>
        [TestMethod]
        public async Task ConcurrentMutationsPublishCompleteImmutableSnapshots()
        {
            using TemporaryDirectory directory = new();
            await using TaskNotesStore store = new(directory.Path);
            await store.InitializeAsync(null, null, TestContext.CancellationToken);
            Task[] additions =
            [
                .. Enumerable
                    .Range(0, 24)
                    .Select(index =>
                        store.AddAsync($"parallel task {index}", TestContext.CancellationToken)
                    ),
            ];

            await Task.WhenAll(additions);

            Assert.HasCount(24, store.State.AllTasks);
            Assert.AreEqual(
                24,
                store
                    .State.AllTasks.Select(task => task.Id)
                    .Distinct(StringComparer.Ordinal)
                    .Count()
            );
        }

        /// <summary>Projects stable labels and automation identifiers without platform dependencies.</summary>
        [TestMethod]
        public void PortableModelsExposeStableComputedLabels()
        {
            TaskItem item = new(
                "task one",
                "Task",
                null,
                "open",
                "Open",
                "normal",
                "Normal",
                "2026-08-11",
                null,
                null,
                null,
                ["Project"],
                ["context"],
                ["tag"],
                null,
                0,
                false,
                false,
                false,
                false,
                true,
                null,
                "Today",
                false
            );
            Assert.AreEqual("Pending", item.PendingLabel);
            Assert.AreEqual("2026-08-11", item.DateLabel);
            Assert.AreEqual("Project  context  tag", item.TaxonomyLabel);
            StringAssert.Contains(item.AutomationId, "task one", StringComparison.Ordinal);
            TodayTask today = new("one", "Task", null, null, false, false, false);
            Assert.AreEqual(string.Empty, today.PendingLabel);
        }

        /// <summary>Keeps a task planned for today on Today even when its deadline is later.</summary>
        [TestMethod]
        public async Task TodayAdmitsATaskScheduledTodayAndDueLater()
        {
            using TemporaryDirectory directory = new();
            await using TaskNotesStore store = new(directory.Path);
            await store.InitializeAsync(null, null, TestContext.CancellationToken);
            string today = DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            string later = DateTime
                .Now.AddDays(3)
                .ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            await store.AddAsync(
                "Plan the release",
                new TaskListQuery(TaskListKind.Inbox),
                TestContext.CancellationToken
            );
            TaskItem created = store.State.AllTasks.Single();
            await store.UpdateTaskAsync(
                new TaskEditInput
                {
                    Id = created.Id,
                    Title = "Plan the release",
                    Status = "open",
                    Priority = "normal",
                    Scheduled = today,
                    Due = later,
                },
                TestContext.CancellationToken
            );

            await AssertQueryTitlesAsync(
                store,
                new TaskListQuery(TaskListKind.Today),
                "Plan the release"
            );
        }

        /// <summary>Applies the sort and grouping a saved view persisted when it is opened.</summary>
        [TestMethod]
        public async Task SavedViewProjectionKeepsItsOwnSortAndGrouping()
        {
            using TemporaryDirectory directory = new();
            await using TaskNotesStore store = new(directory.Path);
            await store.InitializeAsync(null, null, TestContext.CancellationToken);
            foreach (string title in SavedViewTitles)
            {
                await store.AddAsync(
                    title,
                    new TaskListQuery(TaskListKind.Project, "[[Windows]]"),
                    TestContext.CancellationToken
                );
            }

            SavedViewDefinition view = await store.CreateSavedViewAsync(
                "Windows By Title",
                "Filter",
                "#2563eb",
                false,
                new TaskListQuery(TaskListKind.Project, "[[Windows]]")
                {
                    Projects = ["[[Windows]]"],
                    Sort = TaskSortChoice.Title,
                    Descending = true,
                    Group = TaskGroupChoice.Project,
                },
                TestContext.CancellationToken
            );

            // The query names only the view, exactly as opening it from the sidebar does.
            await store.SetQueryAsync(
                new TaskListQuery(TaskListKind.SavedView, view.Id),
                TestContext.CancellationToken
            );

            Assert.AreSequenceEqual(
                DescendingSavedViewTitles,
                store.State.VisibleTasks.Select(task => task.Title).ToArray()
            );
            Assert.IsTrue(
                store.State.VisibleTasks.All(task => !string.IsNullOrEmpty(task.GroupLabel))
            );
        }

        private static readonly string[] SavedViewTitles = ["Alpha", "Zulu", "Mike"];
        private static readonly string[] DescendingSavedViewTitles = ["Zulu", "Mike", "Alpha"];

        private async Task AssertQueryTitlesAsync(
            TaskNotesStore store,
            TaskListQuery query,
            params string[] expected
        )
        {
            await store.SetQueryAsync(query, TestContext.CancellationToken);
            Assert.AreEquivalent(expected, store.State.VisibleTasks.Select(task => task.Title));
        }

        /// <summary>Gets or sets the MSTest execution context.</summary>
        public required TestContext TestContext { get; set; }
    }
}
