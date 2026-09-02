using System.Text.Json;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests
{
    /// <summary>Exercises the cached-first Today slice through the public store.</summary>
    [TestClass]
    public sealed class TaskNotesStoreTests
    {
        /// <summary>Publishes loading before the restored unconfigured state.</summary>
        [TestMethod]
        public async Task InitializationPublishesLoadingState()
        {
            using TemporaryDirectory directory = new();
            await using TaskNotesStore store = new(directory.Path);
            List<TaskNotesSyncState> observed = [];
            store.StateChanged += (_, _) => observed.Add(store.State.SyncState);

            await store.InitializeAsync(null, null, TestContext.CancellationToken);

            Assert.AreSequenceEqual(
                [TaskNotesSyncState.Loading, TaskNotesSyncState.Unconfigured],
                observed
            );
        }

        /// <summary>Queues, completes, reopens, and restores an offline task.</summary>
        [TestMethod]
        public async Task OfflineTodayMutationLifecyclePersistsAcrossRestart()
        {
            using TemporaryDirectory directory = new();
            string taskId;
            await using (TaskNotesStore store = new(directory.Path))
            {
                await store.InitializeAsync(null, null, TestContext.CancellationToken);
                Assert.AreEqual(TaskNotesSyncState.Unconfigured, store.State.SyncState);

                await store.AddAsync("Buy milk", TestContext.CancellationToken);
                TodayTask created = store.State.TodayTasks.Single();
                taskId = created.Id;
                Assert.IsTrue(created.IsPending);
                Assert.IsFalse(created.IsCompleted);

                await store.SetCompletionAsync(taskId, true, TestContext.CancellationToken);
                Assert.DoesNotContain(task => task.Id == taskId, store.State.TodayTasks);

                await store.SetCompletionAsync(taskId, false, TestContext.CancellationToken);
                TodayTask reopened = store.State.TodayTasks.Single(task => task.Id == taskId);
                Assert.IsFalse(reopened.IsCompleted);
            }

            await using TaskNotesStore restored = new(directory.Path);
            await restored.InitializeAsync(null, null, TestContext.CancellationToken);

            TodayTask persisted = restored.State.TodayTasks.Single(task => task.Id == taskId);
            Assert.IsTrue(persisted.IsPending);
            Assert.IsFalse(persisted.IsCompleted);
        }

        /// <summary>Persists retry and discard decisions for parked mutations.</summary>
        [TestMethod]
        public async Task ParkedMutationRetryAndDiscardUpdateDurableStorage()
        {
            using TemporaryDirectory directory = new();
            await using (TaskNotesStore seed = new(directory.Path))
            {
                await seed.InitializeAsync(null, null, TestContext.CancellationToken);
                await seed.AddAsync("Retry this today", TestContext.CancellationToken);
                await seed.AddAsync("Discard this today", TestContext.CancellationToken);
            }

            string queuePath = Path.Combine(directory.Path, "queue.json");
            string queueJson = await File.ReadAllTextAsync(
                queuePath,
                TestContext.CancellationToken
            );
            using JsonDocument queued = JsonDocument.Parse(queueJson);
            JsonElement[] commands = [.. queued.RootElement.EnumerateArray()];
            Assert.HasCount(2, commands);
            string parkedJson = $$"""
                [
                  {
                    "command": {{commands[0].GetRawText()}},
                    "error": { "name": "ApiError", "message": "retry me", "status": 422 },
                    "failedAt": 1700000000000
                  },
                  {
                    "command": {{commands[1].GetRawText()}},
                    "error": { "name": "ApiError", "message": "discard me", "status": 422 },
                    "failedAt": 1700000000001
                  }
                ]
                """;
            await File.WriteAllTextAsync(queuePath, "[]", TestContext.CancellationToken);
            await File.WriteAllTextAsync(
                Path.Combine(directory.Path, "dead-letter.json"),
                parkedJson,
                TestContext.CancellationToken
            );

            await using (TaskNotesStore store = new(directory.Path))
            {
                await store.InitializeAsync(null, null, TestContext.CancellationToken);
                Assert.HasCount(2, store.State.ParkedChanges);

                await store.DiscardParkedMutationAsync(
                    store.State.ParkedChanges[1].Id,
                    TestContext.CancellationToken
                );
                Assert.HasCount(1, store.State.ParkedChanges);

                await store.RetryParkedMutationAsync(
                    store.State.ParkedChanges[0].Id,
                    TestContext.CancellationToken
                );
                Assert.HasCount(0, store.State.ParkedChanges);
                Assert.AreEqual((uint)1, store.State.PendingCount);
            }

            Assert.AreEqual(
                "[]",
                await File.ReadAllTextAsync(
                    Path.Combine(directory.Path, "dead-letter.json"),
                    TestContext.CancellationToken
                )
            );
            Assert.AreNotEqual(
                "[]",
                await File.ReadAllTextAsync(queuePath, TestContext.CancellationToken)
            );
        }

        /// <summary>Applies native destination defaults without rejecting fixed or board destinations.</summary>
        [TestMethod]
        public async Task QuickAddDefaultsFollowTheActiveDestination()
        {
            using TemporaryDirectory directory = new();
            await using TaskNotesStore store = new(directory.Path);
            await store.InitializeAsync(null, null, TestContext.CancellationToken);

            QuickAddPreview today = await store.PreviewQuickAddAsync(
                "Write the Windows plan",
                TestContext.CancellationToken
            );
            Assert.IsNotNull(today.Due);

            await store.SetQueryAsync(
                new TaskListQuery(TaskListKind.Project, "[[TaskNotes Windows]]"),
                TestContext.CancellationToken
            );
            QuickAddPreview project = await store.PreviewQuickAddAsync(
                "Review the implementation",
                TestContext.CancellationToken
            );
            Assert.AreSequenceEqual(["[[TaskNotes Windows]]"], project.Projects);

            await store.SetQueryAsync(
                new TaskListQuery(TaskListKind.Context, "desktop"),
                TestContext.CancellationToken
            );
            QuickAddPreview context = await store.PreviewQuickAddAsync(
                "Run the package",
                TestContext.CancellationToken
            );
            Assert.AreSequenceEqual(["desktop"], context.Contexts);

            foreach (
                TaskListKind kind in new[]
                {
                    TaskListKind.Inbox,
                    TaskListKind.Upcoming,
                    TaskListKind.Browse,
                    TaskListKind.Completed,
                    TaskListKind.Board,
                }
            )
            {
                await store.SetQueryAsync(new TaskListQuery(kind), TestContext.CancellationToken);
                QuickAddPreview preview = await store.PreviewQuickAddAsync(
                    $"Create from {kind}",
                    TestContext.CancellationToken
                );
                Assert.AreEqual($"Create from {kind}", preview.Title);
            }
        }

        /// <summary>Filters native destinations with the core and restores grouped completion as one undo.</summary>
        [TestMethod]
        public async Task QueryProjectionAndGroupedCompletionUndoUseCoreState()
        {
            using TemporaryDirectory directory = new();
            await using TaskNotesStore store = new(directory.Path);
            await store.InitializeAsync(null, null, TestContext.CancellationToken);
            TaskListQuery projectQuery = new(TaskListKind.Project, "[[Windows]]");
            await store.AddAsync("Alpha task", projectQuery, TestContext.CancellationToken);
            await store.AddAsync("Beta task", projectQuery, TestContext.CancellationToken);
            await store.AddAsync(
                "Inbox task",
                new TaskListQuery(TaskListKind.Inbox),
                TestContext.CancellationToken
            );

            await store.SetQueryAsync(
                projectQuery with
                {
                    Search = "task",
                    Sort = TaskSortChoice.Title,
                    Descending = true,
                    Group = TaskGroupChoice.Project,
                },
                TestContext.CancellationToken
            );
            TaskItem[] visibleTasks = [.. store.State.VisibleTasks];
            Assert.AreSequenceEqual(
                ["Beta task", "Alpha task"],
                [.. visibleTasks.Select(task => task.Title)]
            );
            Assert.IsTrue(visibleTasks.All(task => task.GroupLabel == "Windows"));

            string[] ids = [.. visibleTasks.Select(task => task.Id)];
            await store.CompleteTasksAsync(ids, TestContext.CancellationToken);
            Assert.IsTrue(
                ids.All(id => store.State.AllTasks.Single(task => task.Id == id).IsCompleted)
            );
            Assert.AreEqual(1, store.State.CompletionUndoDepth);

            await store.UndoCompletionAsync(TestContext.CancellationToken);
            Assert.IsTrue(
                ids.All(id => !store.State.AllTasks.Single(task => task.Id == id).IsCompleted)
            );
            Assert.AreEqual(0, store.State.CompletionUndoDepth);
        }

        /// <summary>Persists the complete saved-view presentation lifecycle across store restarts.</summary>
        [TestMethod]
        public async Task SavedViewLifecyclePersistsPresentationAndCoreQuery()
        {
            using TemporaryDirectory directory = new();
            string duplicateId;
            await using (TaskNotesStore store = new(directory.Path))
            {
                await store.InitializeAsync(null, null, TestContext.CancellationToken);
                SavedViewDefinition created = await store.CreateSavedViewAsync(
                    "Windows Focus",
                    "Filter",
                    "#2563eb",
                    false,
                    new TaskListQuery(TaskListKind.Browse)
                    {
                        Search = "windows",
                        Priorities = ["high"],
                        Sort = TaskSortChoice.DueDate,
                        Group = TaskGroupChoice.Priority,
                    },
                    TestContext.CancellationToken
                );
                SavedViewDefinition duplicate = await store.DuplicateSavedViewAsync(
                    created.Id,
                    TestContext.CancellationToken
                );
                duplicateId = duplicate.Id;
                await store.UpdateSavedViewAsync(
                    duplicate with
                    {
                        Name = "Pinned Windows Focus",
                        Symbol = "Favorite",
                        Tint = "#7c3aed",
                        IsFavorite = true,
                    },
                    TestContext.CancellationToken
                );
                await store.MoveSavedViewAsync(duplicate.Id, 0, TestContext.CancellationToken);
                await store.DeleteSavedViewAsync(created.Id, TestContext.CancellationToken);
            }

            await using TaskNotesStore restored = new(directory.Path);
            await restored.InitializeAsync(null, null, TestContext.CancellationToken);
            SavedViewDefinition persisted = restored.State.SavedViews.Single(view =>
                view.Id == duplicateId
            );
            Assert.AreEqual("Pinned Windows Focus", persisted.Name);
            Assert.AreEqual("Favorite", persisted.Symbol);
            Assert.AreEqual("#7c3aed", persisted.Tint);
            Assert.IsTrue(persisted.IsFavorite);
            Assert.AreEqual(TaskGroupChoice.Priority, persisted.Group);
            Assert.IsNotNull(persisted.SortJson);
        }

        /// <summary>Fails initialization loudly when saved-view metadata is corrupt.</summary>
        [TestMethod]
        public async Task CorruptSavedViewsFailInitialization()
        {
            using TemporaryDirectory directory = new();
            await File.WriteAllTextAsync(
                Path.Combine(directory.Path, "saved-views.json"),
                "not json",
                TestContext.CancellationToken
            );
            await using TaskNotesStore store = new(directory.Path);

            _ = await Assert.ThrowsExactlyAsync<uniffi.TaskNotesCore.CoreException.Validation>(
                async () =>
                    await store.InitializeAsync(null, null, TestContext.CancellationToken)
            );
        }

        /// <summary>Gets or sets the MSTest execution context.</summary>
        public required TestContext TestContext { get; set; }
    }
}
