using System.Globalization;
using System.Net;
using System.Net.Sockets;
using TaskNotes.Protocol;
using TaskNotes.Windows.Host;
using Task = System.Threading.Tasks.Task;

namespace TaskNotes.Windows.Tests
{
    /// <summary>Runs the portable C# FacetSyncStore + SQLite cache against the real Bun tasknotes-server /api/v1/sync endpoint.</summary>
    [TestClass]
    [DoNotParallelize]
    public sealed class ServerIntegrationTests
    {
        private const string Token = "tasknotes-windows-integration-token";

        /// <summary>Gets or sets the MSTest execution context.</summary>
        public required TestContext TestContext { get; set; }

        /// <summary>Auto-provisions Inbox, syncs task creation, clears nullable fields via empty strings, and replicates deltas across clients.</summary>
        [TestMethod]
        public async Task SyncRoundTripCoversInboxProvisioningFieldClearsAndIncrementalDeltaSync()
        {
            using TaskNotesServerProcess server = await TaskNotesServerProcess.StartAsync(Token);
            using TemporaryDirectory dirA = new();
            using TemporaryDirectory dirB = new();

            await using FacetSyncStore clientA = new(dirA.Path);
            await using FacetSyncStore clientB = new(dirB.Path);

            await clientA.InitializeAsync(
                server.BaseUrl.AbsoluteUri,
                Token,
                TestContext.CancellationToken
            );
            Assert.AreEqual(TaskNotesSyncState.Connected, clientA.State.SyncState);

            await clientA.AddAsync(
                "Ship Facet Windows today p1",
                TaskListQuery.Today,
                TestContext.CancellationToken
            );
            Assert.AreEqual((uint)0, clientA.State.PendingCount);
            TaskItem created = clientA.State.AllTasks.Single();
            Assert.IsFalse(created.Id.StartsWith("tmp-", StringComparison.Ordinal));
            Assert.AreEqual("p1", created.Priority);

            await clientB.InitializeAsync(
                server.BaseUrl.AbsoluteUri,
                Token,
                TestContext.CancellationToken
            );
            Assert.AreEqual(created.Id, clientB.State.AllTasks.Single().Id);

            TaskItem cleared = await clientA.SaveTaskEditAsync(
                new TaskEditInput
                {
                    Id = created.Id,
                    Title = "Ship Facet Windows Updated",
                    Details = "Verified against real server",
                    Status = "open",
                    Priority = "p2",
                    Projects = created.Projects,
                    BodyChanged = true,
                },
                TestContext.CancellationToken
            );
            Assert.IsNull(cleared.Due);

            await clientB.SetQueryAsync(
                new TaskListQuery(TaskListKind.Inbox),
                TestContext.CancellationToken
            );
            await clientB.RefreshAsync(TestContext.CancellationToken);
            TaskItem syncedOnB = clientB.State.AllTasks.Single();
            Assert.AreEqual("Ship Facet Windows Updated", syncedOnB.Title);
            Assert.AreEqual("Verified against real server", syncedOnB.Details);
            Assert.IsNull(syncedOnB.Due);
            Assert.AreEqual("p2", syncedOnB.Priority);

            SavedViewDefinition savedView = await clientA.CreateSavedViewAsync(
                "Urgent Queue",
                "Filter",
                "#D1453B",
                true,
                new TaskListQuery(TaskListKind.Browse) { Priorities = ["p2"] },
                TestContext.CancellationToken
            );
            Assert.IsFalse(savedView.Id.StartsWith("tmp-", StringComparison.Ordinal));

            await clientB.RefreshAsync(TestContext.CancellationToken);
            Assert.AreEqual("Urgent Queue", clientB.State.SavedViews.Single().Name);

            await clientA.DeleteTaskAsync(created.Id, TestContext.CancellationToken);
            await clientB.RefreshAsync(TestContext.CancellationToken);
            Assert.IsEmpty(clientB.State.AllTasks);
        }

        /// <summary>Persists offline temp-ID batches in SQLite, remaps IDs on reconnect, and enforces Bearer auth + parked error handling.</summary>
        [TestMethod]
        public async Task OfflineTempIdBatchReplayAuthGateAndParkedMutationLifecycle()
        {
            using TemporaryDirectory directory = new();
            Uri unreachable = ReserveUnreachableUrl();

            await using (FacetSyncStore offline = new(directory.Path))
            {
                await offline.InitializeAsync(
                    unreachable.AbsoluteUri,
                    Token,
                    TestContext.CancellationToken
                );
                Assert.AreEqual(TaskNotesSyncState.CachedOffline, offline.State.SyncState);

                string tempProj = await offline.CreateProjectAsync(
                    "Architecture",
                    "#246FE0",
                    false,
                    TestContext.CancellationToken
                );
                _ = await offline.CreateSectionAsync(
                    tempProj,
                    "In Flight",
                    1,
                    TestContext.CancellationToken
                );
                await offline.AddAsync(
                    "Design SQLite outbox #Architecture @core today p1",
                    TaskListQuery.Today,
                    TestContext.CancellationToken
                );
                Assert.IsGreaterThanOrEqualTo(4u, offline.State.PendingCount);
            }

            using TaskNotesServerProcess server = await TaskNotesServerProcess.StartAsync(Token);
            await using FacetSyncStore reconnected = new(directory.Path);
            await reconnected.InitializeAsync(
                server.BaseUrl.AbsoluteUri,
                "wrong-token",
                TestContext.CancellationToken
            );
            Assert.AreEqual(TaskNotesSyncState.AuthenticationFailure, reconnected.State.SyncState);
            Assert.AreEqual("Design SQLite outbox", reconnected.State.TodayTasks.Single().Title);

            await reconnected.ReconfigureAsync(
                server.BaseUrl.AbsoluteUri,
                Token,
                TestContext.CancellationToken
            );
            Assert.AreEqual(TaskNotesSyncState.Connected, reconnected.State.SyncState);
            Assert.AreEqual((uint)0, reconnected.State.PendingCount);
            TaskItem syncedTask = reconnected.State.AllTasks.Single();
            Assert.IsFalse(syncedTask.Id.StartsWith("tmp-", StringComparison.Ordinal));
            Assert.AreSequenceEqual(["Architecture"], syncedTask.Projects);
            Assert.AreSequenceEqual(["core"], syncedTask.Tags);

            using (FacetSqliteCache directCache = FacetSqliteCache.OpenDirectory(directory.Path))
            {
                directCache.EnqueueAndApply(
                    [
                        new QueuedCommand(
                            "bad-update-uuid",
                            null,
                            new SyncCommand.TaskUpdate(
                                new TaskUpdateArgs(Id: "nonexistent-task-id", Title: "Will Park")
                            )
                        ),
                    ],
                    DateTimeOffset.UtcNow
                );
            }

            await using FacetSyncStore withParked = new(directory.Path);
            await withParked.InitializeAsync(
                server.BaseUrl.AbsoluteUri,
                Token,
                TestContext.CancellationToken
            );
            Assert.HasCount(1, withParked.State.ParkedChanges);
            Assert.AreEqual("bad-update-uuid", withParked.State.ParkedChanges[0].Id);

            await withParked.DiscardParkedMutationAsync(
                "bad-update-uuid",
                TestContext.CancellationToken
            );
            Assert.IsEmpty(withParked.State.ParkedChanges);
        }

        /// <summary>Advances recurring tasks on server completion and restores prior due date on Undo.</summary>
        [TestMethod]
        public async Task RecurringTaskCompletionAndUndoRoundTripAgainstRealServer()
        {
            string today = DateTimeOffset.UtcNow.ToString(
                "yyyy-MM-dd",
                CultureInfo.InvariantCulture
            );
            using TaskNotesServerProcess server = await TaskNotesServerProcess.StartAsync(Token);
            using TemporaryDirectory directory = new();
            await using FacetSyncStore store = new(directory.Path);

            await store.InitializeAsync(
                server.BaseUrl.AbsoluteUri,
                Token,
                TestContext.CancellationToken
            );
            await store.AddAsync(
                $"Daily stand-up {today} daily",
                TaskListQuery.Today,
                TestContext.CancellationToken
            );

            TaskItem recurring = store.State.AllTasks.Single();
            Assert.IsTrue(recurring.IsRecurring);
            Assert.AreEqual(today, recurring.Due);

            await store.SetCompletionAsync(recurring.Id, true, TestContext.CancellationToken);
            TaskItem advanced = store.State.AllTasks.Single();
            Assert.IsFalse(advanced.IsCompleted);
            Assert.AreNotEqual(today, advanced.Due);

            await store.UndoCompletionAsync(TestContext.CancellationToken);
            TaskItem restored = store.State.AllTasks.Single();
            Assert.IsFalse(restored.IsCompleted);
            Assert.AreEqual(today, restored.Due);
        }

        private static Uri ReserveUnreachableUrl()
        {
            TcpListener listener = new(IPAddress.Loopback, 0);
            listener.Start();
            int port;
            try
            {
                port = ((IPEndPoint)listener.LocalEndpoint).Port;
            }
            finally
            {
                listener.Stop();
            }

            return new Uri($"http://127.0.0.1:{port}", UriKind.Absolute);
        }
    }
}
