using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests
{
    /// <summary>Runs the portable Windows host against the real Bun TaskNotes server and vault.</summary>
    [TestClass]
    [DoNotParallelize]
    public sealed class ServerIntegrationTests
    {
        private const string Token = "tasknotes-windows-integration-token";
        private static readonly string[] AuthenticatedTaskFile = ["Authenticated task.md"];
        private static readonly string[] OfflineTaskFile = ["Survives offline.md"];
        private static readonly string[] WindowsTaskFile = ["Ship Windows.md"];

        /// <summary>Creates, completes, and reopens a task against an open server.</summary>
        [TestMethod]
        public async Task OpenServerTodayFlowReachesMarkdown()
        {
            using TaskNotesServerProcess server = await TaskNotesServerProcess.StartAsync();
            using TemporaryDirectory directory = new();
            await using TaskNotesStore store = new(directory.Path);

            await store.InitializeAsync(
                server.BaseUrl.AbsoluteUri,
                null,
                TestContext.CancellationToken
            );
            Assert.AreEqual(TaskNotesSyncState.Connected, store.State.SyncState);

            await store.AddAsync("Ship Windows today !high", TestContext.CancellationToken);
            TodayTask optimistic = store.State.TodayTasks.Single();
            Assert.IsTrue(optimistic.IsPending);
            await store.RefreshAsync(TestContext.CancellationToken);

            Assert.AreSequenceEqual(WindowsTaskFile, server.MarkdownFiles());
            string markdown = server.Contents("Ship Windows.md");
            Assert.Contains("status: open", markdown);
            Assert.Contains("priority: high", markdown);

            string taskId = store.State.TodayTasks.Single().Id;
            await store.SetCompletionAsync(taskId, true, TestContext.CancellationToken);
            await store.RefreshAsync(TestContext.CancellationToken);
            Assert.Contains("status: done", server.Contents("Ship Windows.md"));

            await store.SetCompletionAsync(taskId, false, TestContext.CancellationToken);
            await store.RefreshAsync(TestContext.CancellationToken);
            Assert.Contains("status: open", server.Contents("Ship Windows.md"));
        }

        /// <summary>Uses a real gated server as the negative and positive credential control.</summary>
        [TestMethod]
        public async Task GatedServerRejectsMissingTokenAndAcceptsConfiguredToken()
        {
            using TaskNotesServerProcess server = await TaskNotesServerProcess.StartAsync(Token);
            using TemporaryDirectory rejectedDirectory = new();
            await using (TaskNotesStore rejected = new(rejectedDirectory.Path))
            {
                await rejected.InitializeAsync(
                    server.BaseUrl.AbsoluteUri,
                    null,
                    TestContext.CancellationToken
                );
                Assert.AreEqual(TaskNotesSyncState.AuthenticationFailure, rejected.State.SyncState);
                await rejected.AddAsync("Must stay queued", TestContext.CancellationToken);
                await rejected.RefreshAsync(TestContext.CancellationToken);
                Assert.AreEqual(TaskNotesSyncState.AuthenticationFailure, rejected.State.SyncState);
                Assert.AreEqual((uint)1, rejected.State.PendingCount);
                Assert.IsEmpty(server.MarkdownFiles());
            }

            using TemporaryDirectory acceptedDirectory = new();
            await using TaskNotesStore accepted = new(acceptedDirectory.Path);
            await accepted.InitializeAsync(
                server.BaseUrl.AbsoluteUri,
                Token,
                TestContext.CancellationToken
            );
            await accepted.AddAsync("Authenticated task", TestContext.CancellationToken);
            await accepted.RefreshAsync(TestContext.CancellationToken);

            Assert.AreEqual(TaskNotesSyncState.Connected, accepted.State.SyncState);
            Assert.AreSequenceEqual(AuthenticatedTaskFile, server.MarkdownFiles());
        }

        /// <summary>Surfaces a non-authentication HTTP failure as a synchronization error.</summary>
        [TestMethod]
        public async Task ServerApiFailureBecomesSynchronizationError()
        {
            using TaskNotesServerProcess server = await TaskNotesServerProcess.StartAsync();
            using TemporaryDirectory directory = new();
            await using TaskNotesStore store = new(directory.Path);
            Uri missingApi = new(server.BaseUrl, "missing");

            await store.InitializeAsync(
                missingApi.AbsoluteUri,
                null,
                TestContext.CancellationToken
            );

            Assert.AreEqual(TaskNotesSyncState.SynchronizationError, store.State.SyncState);
            Assert.IsFalse(string.IsNullOrWhiteSpace(store.State.UserFacingError));
        }

        /// <summary>Restores cached Today data and pending work before recovering against a live server.</summary>
        [TestMethod]
        public async Task CachedOfflineStartupRecoversAgainstLiveServer()
        {
            using TemporaryDirectory directory = new();
            Uri unavailable = ReserveUnreachableUrl();
            await using (TaskNotesStore offline = new(directory.Path))
            {
                await offline.InitializeAsync(
                    unavailable.AbsoluteUri,
                    null,
                    TestContext.CancellationToken
                );
                Assert.AreEqual(TaskNotesSyncState.CachedOffline, offline.State.SyncState);
                await offline.AddAsync("Survives offline today", TestContext.CancellationToken);
                Assert.AreEqual((uint)1, offline.State.PendingCount);
            }

            await using (TaskNotesStore restoredOffline = new(directory.Path))
            {
                await restoredOffline.InitializeAsync(
                    unavailable.AbsoluteUri,
                    null,
                    TestContext.CancellationToken
                );
                Assert.AreEqual(TaskNotesSyncState.CachedOffline, restoredOffline.State.SyncState);
                Assert.AreEqual(
                    "Survives offline",
                    restoredOffline.State.TodayTasks.Single().Title
                );
            }

            using TaskNotesServerProcess server = await TaskNotesServerProcess.StartAsync();
            await using TaskNotesStore recovered = new(directory.Path);
            await recovered.InitializeAsync(
                server.BaseUrl.AbsoluteUri,
                null,
                TestContext.CancellationToken
            );

            Assert.AreEqual(TaskNotesSyncState.Connected, recovered.State.SyncState);
            Assert.AreEqual((uint)0, recovered.State.PendingCount);
            Assert.AreSequenceEqual(OfflineTaskFile, server.MarkdownFiles());
        }

        /// <summary>Completes a recurring occurrence without closing its series.</summary>
        [TestMethod]
        public async Task RecurringCompletionUsesTheCoreOccurrenceTarget()
        {
            string today = DateTimeOffset.Now.ToString(
                "yyyy-MM-dd",
                System.Globalization.CultureInfo.InvariantCulture
            );
            string markdown = $"""
                ---
                title: Daily stand-up
                status: open
                priority: normal
                scheduled: {today}
                recurrence: FREQ=DAILY
                recurrence_anchor: scheduled
                complete_instances: []
                tags:
                  - task
                ---
                """;
            Dictionary<string, string> seed = new(StringComparer.Ordinal)
            {
                ["Daily stand-up.md"] = markdown,
            };
            using TaskNotesServerProcess server = await TaskNotesServerProcess.StartAsync(
                seedFiles: seed
            );
            using TemporaryDirectory directory = new();
            await using TaskNotesStore store = new(directory.Path);
            await store.InitializeAsync(
                server.BaseUrl.AbsoluteUri,
                null,
                TestContext.CancellationToken
            );

            TodayTask row = store.State.TodayTasks.Single();
            Assert.IsTrue(row.IsRecurring);
            await store.SetCompletionAsync(row.Id, true, TestContext.CancellationToken);
            Assert.IsTrue(store.State.TodayTasks.Single().IsCompleted);
            await store.RefreshAsync(TestContext.CancellationToken);

            string settled = server.Contents("Daily stand-up.md");
            Assert.Contains(today, settled);
            Assert.Contains("status: open", settled);
        }

        private static Uri ReserveUnreachableUrl()
        {
            System.Net.Sockets.TcpListener listener = new(System.Net.IPAddress.Loopback, 0);
            listener.Start();
            int port;
            try
            {
                port = ((System.Net.IPEndPoint)listener.LocalEndpoint).Port;
            }
            finally
            {
                listener.Stop();
            }

            return new Uri($"http://127.0.0.1:{port}", UriKind.Absolute);
        }

        /// <summary>Gets or sets the MSTest execution context.</summary>
        public required TestContext TestContext { get; set; }
    }
}
