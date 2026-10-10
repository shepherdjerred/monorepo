using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Tests;

/// <summary>Production standalone facade through real SQLite, native Rust and Markdown files.</summary>
[TestClass]
public sealed partial class FacetStoreTests
{
    /// <summary>Retained ID-based consumers still support their existing bulk command/undo contract.</summary>
    [TestMethod]
    public async Task RetainedFacadeBulkCommandsRemainCompatible()
    {
        using Fixture fixture = new();
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        await store.AddAsync(
            "First compatibility task",
            TaskListQuery.Today,
            TestContext.CancellationToken
        );
        await store.AddAsync(
            "Second compatibility task",
            TaskListQuery.Today,
            TestContext.CancellationToken
        );
        string[] ids = store.State.AllTasks.Select(task => task.Id).ToArray();
        await store.CompleteTasksAsync(ids, TestContext.CancellationToken);
        Assert.IsTrue(store.State.AllTasks.All(task => task.IsCompleted));
        await store.UndoCompletionAsync(TestContext.CancellationToken);
        await store.ScheduleTasksAsync(ids, "2026-10-12", TestContext.CancellationToken);
        await store.PrioritizeTasksAsync(ids, "high", TestContext.CancellationToken);
        Assert.IsTrue(
            store.State.AllTasks.All(task =>
                !task.IsCompleted && task.Scheduled == "2026-10-12" && task.Priority == "high"
            )
        );
        await store.SetStatusAsync(ids[0], "done", TestContext.CancellationToken);
        Assert.IsTrue(store.State.AllTasks.Single(task => task.Id == ids[0]).IsCompleted);
        await store.DeleteTasksAsync(ids, TestContext.CancellationToken);
        Assert.IsEmpty(store.State.AllTasks);
    }

    /// <summary>Named-view dialogs freeze the original query/profile and expose the exact durable submission.</summary>
    [TestMethod]
    public async Task SavedViewOwnerAndQueryAreFrozenBeforeTheHostQueue()
    {
        using Fixture fixture = new();
        fixture.AddSecondProfile();
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        var query = new TaskListQuery(TaskListKind.Project, "Reviewed project");
        bool admitted = false;
        Task switching = store.SelectProfileAsync("q", TestContext.CancellationToken);
        Task request = store.CreateOwnedSavedViewAsync(
            "p",
            "original-view",
            "Original",
            "Filter",
            "Accent",
            false,
            query,
            _ => admitted = true,
            TestContext.CancellationToken
        );
        await switching;
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(async () =>
            await request.WaitAsync(TestContext.CancellationToken)
        );
        Assert.IsFalse(admitted);
        Assert.IsEmpty(new FacetMutationJournal(fixture.StatePath).PendingEntries);
        await store.SelectProfileAsync("p", TestContext.CancellationToken);
        SavedViewDefinition saved = await store.CreateOwnedSavedViewAsync(
            "p",
            "owned-view",
            "Reviewed",
            "Filter",
            "Accent",
            true,
            query,
            id =>
            {
                admitted = true;
                var entry = new FacetMutationJournal(fixture.StatePath).PendingEntries.Single();
                Assert.AreEqual(id, entry.Id);
                Assert.AreEqual("p", entry.Profile);
                using var envelope = JsonDocument.Parse(entry.Document);
                var command = envelope.RootElement.GetProperty("command");
                Assert.AreEqual("owned-view", command.GetProperty("id").GetString());
                Assert.AreEqual(
                    "Reviewed",
                    command.GetProperty("view").GetProperty("name").GetString()
                );
            },
            TestContext.CancellationToken
        );
        Assert.IsTrue(admitted);
        Assert.AreEqual("owned-view", saved.Id);
        Assert.AreEqual("Reviewed", saved.Name);
        Assert.IsTrue(saved.IsFavorite);
        StringAssert.Contains(saved.FilterJson, "Reviewed project", StringComparison.Ordinal);
        Assert.IsEmpty(new FacetMutationJournal(fixture.StatePath).PendingEntries);
    }

    /// <summary>Recurring row membership is immutable; note-scoped edits explicitly collapse occurrences only.</summary>
    [TestMethod]
    public async Task RenderedRowsFreezeOccurrencesRevisionsAndOwningVault()
    {
        using Fixture fixture = new();
        fixture.AddSecondProfile();
        fixture.Seed(
            "repeat.md",
            "---\ntitle: Repeating\nstatus: open\npriority: normal\ntags: [task]\ndateCreated: '2026-10-03T12:00:00Z'\nscheduled: '2026-10-08'\nrecurrence: 'DTSTART:20261008;FREQ=DAILY'\n---\n"
        );
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        var original = store.State.AllTasks.Single();
        var first = RowOccurrence(original, "2026-10-08");
        var second = RowOccurrence(original, "2026-10-09");
        TaskItem[] rows = [first, second];
        var frozen = FacetRowCommands.Freeze(rows);
        rows[0] = first with { ExpectedRevision = "changed-after-admission" };
        Assert.HasCount(2, frozen);
        Assert.AreSequenceEqual(
            ["2026-10-08", "2026-10-09"],
            frozen.Select(row => row.Occurrence).ToArray()
        );
        Assert.IsTrue(frozen.All(row => row.Revision == original.ExpectedRevision));
        Assert.HasCount(1, FacetRowCommands.Notes(frozen));
        _ = Assert.ThrowsExactly<ArgumentException>(() =>
            store.CompleteRowsAsync([first, second], TestContext.CancellationToken)
        );
        Assert.IsEmpty(new FacetMutationJournal(fixture.StatePath).PendingEntries);
        _ = Assert.ThrowsExactly<ArgumentException>(() =>
            FacetRowCommands.Freeze([first, second with { ProfileId = "q" }])
        );
        _ = Assert.ThrowsExactly<ArgumentException>(() =>
            FacetRowCommands.Notes(
                FacetRowCommands.Freeze([
                    first,
                    second with
                    {
                        ExpectedRevision = "other-revision",
                    },
                ])
            )
        );

        // A later query replaces the facade projection, but the clicked occurrence remains exact.
        await store.SetQueryAsync(
            new TaskListQuery(TaskListKind.Browse),
            TestContext.CancellationToken
        );
        await store.SetRowCompletionAsync(first, true, TestContext.CancellationToken);
        string contents = await File.ReadAllTextAsync(
            Path.Combine(fixture.Root, "repeat.md"),
            TestContext.CancellationToken
        );
        StringAssert.Contains(contents, "2026-10-08", StringComparison.Ordinal);
        using var read = JsonDocument.Parse(
            store.State.AllTasks.Single().Properties!.Value.GetRawText()
        );
        Assert.AreSequenceEqual(
            ["2026-10-08"],
            read.RootElement.GetProperty("completeInstances")
                .EnumerateArray()
                .Select(value => value.GetString())
                .ToArray()
        );

        // A stale reviewed row is rejected rather than silently rebased to the mutable current projection.
        _ = await Assert.ThrowsExactlyAsync<Core.FacetEngineException.Conflict>(() =>
            store.SetRowCompletionAsync(second, true, TestContext.CancellationToken)
        );
        var retained = new FacetMutationJournal(fixture.StatePath).PendingEntries.Single();
        using var envelope = JsonDocument.Parse(retained.Document);
        var command = envelope.RootElement.GetProperty("command");
        Assert.AreEqual("2026-10-09", command.GetProperty("occurrenceDate").GetString());
        Assert.AreEqual(
            original.ExpectedRevision,
            command.GetProperty("expectedRevision").GetString()
        );

        // Queue a profile switch ahead of the action: the frozen owner fence runs inside serialization.
        Task switching = store.SelectProfileAsync("q", TestContext.CancellationToken);
        Task wrongOwner = store.SetRowStatusAsync(second, "done", TestContext.CancellationToken);
        await switching;
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(async () =>
            await wrongOwner.WaitAsync(TestContext.CancellationToken)
        );
        Assert.HasCount(1, new FacetMutationJournal(fixture.StatePath).PendingEntries);
        Assert.IsEmpty(store.State.AllTasks);
    }

    private static TaskItem RowOccurrence(TaskItem task, string occurrence) =>
        task with
        {
            OccurrenceDate = occurrence,
        };

    /// <summary>Frozen capture owners are checked inside the host queue; admission exposes only an already durable envelope.</summary>
    [TestMethod]
    public async Task CaptureOwnerFenceAndAdmissionUseTheDurableJournal()
    {
        using Fixture fixture = new();
        fixture.AddSecondProfile();
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        await store.SelectProfileAsync("q", TestContext.CancellationToken);
        bool admitted = false;
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            store.AddCaptureAsync(
                "Wrong vault",
                TaskListQuery.Today,
                "p",
                _ => admitted = true,
                TestContext.CancellationToken
            )
        );
        Assert.IsFalse(admitted);
        Assert.IsEmpty(store.State.AllTasks);
        Assert.IsEmpty(new FacetMutationJournal(fixture.StatePath).PendingEntries);
        string? identity = null;
        await store.AddCaptureAsync(
            "Owned capture",
            TaskListQuery.Today,
            "q",
            id =>
            {
                identity = id;
                var entry = new FacetMutationJournal(fixture.StatePath).PendingEntries.Single();
                Assert.AreEqual(id, entry.Id);
                Assert.AreEqual("q", entry.Profile);
            },
            TestContext.CancellationToken
        );
        Assert.IsNotNull(identity);
        Assert.AreEqual("Owned capture", store.State.AllTasks.Single().Title);
        Assert.AreEqual("q", store.State.AllTasks.Single().ProfileId);
    }

    /// <summary>Existing private drafts survive startup without exposing retired execution; native absence permits only explicit owned cleanup.</summary>
    [TestMethod]
    public async Task HistoricalActionsRemainReadableAndRetireAfterNativeObservation()
    {
        using Fixture fixture = new();
        const string original =
            "---\ntitle: Existing\nstatus: open\npriority: normal\ntags: [task]\ndateCreated: '2026-10-03T12:00:00Z'\ntimeEntries: [{startTime: '2026-10-03T11:00:00Z'}]\n---\nRetain all bytes\n";
        fixture.Seed("existing.md", original);
        var journal = new FacetMutationJournal(fixture.StatePath);
        var old = journal.Prepare("p", new { kind = "start_time", path = "existing.md" });
        var timer = journal.Prepare(
            "p",
            new
            {
                kind = "pomodoro",
                deviceId = "phone",
                action = "start",
            }
        );
        var active = journal.Prepare(
            "p",
            new { kind = "create", properties = new { title = "Retained supported draft" } }
        );
        string journalPath = Path.Combine(fixture.StatePath, "mutation-envelopes.json");
        byte[] before = await File.ReadAllBytesAsync(journalPath, TestContext.CancellationToken);
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        Assert.AreEqual("Existing", store.State.AllTasks.Single().Title);
        Assert.HasCount(3, store.State.FacetPendingActions);
        Assert.IsFalse(
            store.State.FacetPendingActions.Single(action => action.Id == old.Id).CanResume
        );
        Assert.IsFalse(
            store.State.FacetPendingActions.Single(action => action.Id == timer.Id).CanResume
        );
        Assert.IsTrue(
            store.State.FacetPendingActions.Single(action => action.Id == active.Id).CanResume
        );
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            store.ResumeMutationAsync(old.Id, TestContext.CancellationToken)
        );
        CollectionAssert.AreEqual(
            before,
            await File.ReadAllBytesAsync(journalPath, TestContext.CancellationToken)
        );
        await store.RetireRejectedMutationAsync(old.Id, TestContext.CancellationToken);
        Assert.HasCount(2, store.State.FacetPendingActions);
        Assert.IsTrue(store.State.FacetPendingActions.Any(action => action.Id == active.Id));
        Assert.IsTrue(store.State.FacetPendingActions.Any(action => action.Id == timer.Id));
        Assert.AreEqual(
            original,
            await File.ReadAllTextAsync(
                Path.Combine(fixture.Root, "existing.md"),
                TestContext.CancellationToken
            )
        );
    }

    private static readonly string[] ClosingWriteTitles = ["Accepted", "Already queued"];

    /// <summary>Actual native warnings clear immediately when a different action is admitted.</summary>
    [TestMethod]
    public async Task SavedWarningIsInvalidatedByRefreshQueryInvalidEditAndAccountActions()
    {
        foreach (
            string action in new[]
            {
                "refresh",
                "query",
                "invalid-edit",
                "sign-out",
                "reauthorize",
                "remove",
            }
        )
        {
            using Fixture fixture = new();
            fixture.Seed(
                ".obsidian/plugins/tasknotes/data.json",
                "{\"storeTitleInFilename\":false,\"taskCreationDefaults\":{\"useBodyTemplate\":true,\"bodyTemplate\":\"Templates/Missing.md\"}}"
            );
            await using var store = fixture.Open();
            await store.InitializeAsync(null, null, TestContext.CancellationToken);
            using var shell = new ShellViewModel(
                store,
                new Dispatcher(),
                NullLogger<ShellViewModel>.Instance
            );
            await store.AddAsync("Saved task", TaskListQuery.Today, TestContext.CancellationToken);
            Assert.IsNotNull(store.State.SavedNotice, action);
            Assert.IsNotNull(shell.SavedNotice, action);
            Assert.AreEqual("Saved", store.State.SavedNotice.Title);
            Assert.Contains(
                "The task was saved without the configured template.",
                store.State.SavedNotice.Messages
            );
            Task request = action switch
            {
                "refresh" => store.RefreshAsync(TestContext.CancellationToken),
                "query" => store.SetQueryAsync(
                    new TaskListQuery(TaskListKind.Browse),
                    TestContext.CancellationToken
                ),
                "invalid-edit" => store.SaveTaskEditAsync(
                    new TaskEditInput
                    {
                        Id = "missing",
                        Title = "Invalid",
                        Status = "open",
                        Priority = "normal",
                    },
                    TestContext.CancellationToken
                ),
                "sign-out" => store.SignOutAsync(TestContext.CancellationToken),
                "reauthorize" => store.ReauthorizeProfileAsync(
                    "p",
                    null,
                    TestContext.CancellationToken
                ),
                _ => store.RemoveProfileAsync("p", TestContext.CancellationToken),
            };
            Assert.IsNull(store.State.SavedNotice, $"Retained notice survived {action} admission.");
            Assert.IsNull(store.State.SavedNoticeOwner);
            Assert.IsNull(store.State.SavedMaintenance);
            Assert.IsNull(shell.SavedNotice, $"Shell retained Saved after {action} admission.");
            Assert.IsNull(shell.SavedMaintenance);
            Exception? rejected = null;
            try
            {
                await request;
            }
            catch (ArgumentException failure) when (action is "invalid-edit" or "reauthorize")
            {
                rejected = failure;
            }
            catch (InvalidOperationException failure) when (action is "reauthorize" or "sign-out")
            {
                rejected = failure;
            }
            catch (Core.FacetEngineException.Conflict failure) when (action == "remove")
            {
                rejected = failure;
            }
            Assert.AreEqual(
                action is "invalid-edit" or "reauthorize" or "remove",
                rejected is not null
            );
            Assert.IsNull(
                store.State.SavedNotice,
                $"Old notice revived after {action} completion."
            );
        }
    }

    /// <summary>A known applied receipt remains Saved when its own subsequent index observation has expected I/O failure.</summary>
    [TestMethod]
    public async Task AppliedWarningSurvivesExpectedObservationFailureWithOriginalJournal()
    {
        using Fixture fixture = new();
        fixture.Seed(
            ".obsidian/plugins/tasknotes/data.json",
            "{\"storeTitleInFilename\":false,\"taskCreationDefaults\":{\"useBodyTemplate\":true,\"bodyTemplate\":\"Templates/Missing.md\"}}"
        );
        var time = new ObservationFaultTime();
        await using var store = fixture.Open(time);
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        bool fail = true;
        store.StateChanged += (_, _) =>
        {
            if (fail && store.State.SavedNotice is not null)
            {
                fail = false;
                time.FailNextRead = true;
            }
        };
        await store.AddAsync(
            "Saved with warning",
            TaskListQuery.Today,
            TestContext.CancellationToken
        );
        Assert.IsNotNull(store.State.SavedNotice);
        Assert.AreEqual(
            "Saved. Refresh the vault to update the list.",
            store.State.SavedMaintenance
        );
        Assert.HasCount(1, new FacetMutationJournal(fixture.StatePath).PendingEntries);
        Assert.HasCount(1, Directory.GetFiles(fixture.Root, "*.md", SearchOption.AllDirectories));
    }

    /// <summary>Successful removal updates native/catalog selection but never erases either vault's files.</summary>
    [TestMethod]
    public async Task SettledProfileRemovalKeepsFilesAndOtherProfile()
    {
        using Fixture fixture = new();
        fixture.Seed(
            "existing.md",
            "---\ntitle: Existing\nstatus: open\npriority: normal\ndateCreated: '2026-10-03T12:00:00Z'\ntags: [task]\n---\nkept\n"
        );
        fixture.AddSecondProfile();
        await using (var store = fixture.Open())
        {
            await store.InitializeAsync(null, null, TestContext.CancellationToken);
            using FacetSettingsViewModel settings = new(store, store, new Dispatcher());
            await settings.RemoveAsync("p", TestContext.CancellationToken);
            Assert.AreEqual("q", store.SelectedProfileId);
            Assert.HasCount(1, store.Profiles);
            Assert.Contains("files remain intact", settings.Status!);
            Assert.IsTrue(File.Exists(Path.Combine(fixture.Root, "existing.md")));
            Assert.IsTrue(Directory.Exists(fixture.SecondRoot));
        }
        await using var restored = fixture.Open();
        await restored.InitializeAsync(null, null, TestContext.CancellationToken);
        Assert.AreEqual("q", restored.SelectedProfileId);
        Assert.HasCount(1, restored.Profiles);
        Assert.IsEmpty(new FacetProfileCatalog(fixture.StatePath).PendingRemovals);
    }

    /// <summary>A native pending upload rejection keeps the original profile, selection, bytes and recoverable catalog.</summary>
    [TestMethod]
    public async Task RejectedProfileRemovalPreservesPendingWork()
    {
        using Fixture fixture = new();
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        await store.AddAsync("Pending", TaskListQuery.Today, TestContext.CancellationToken);
        TaskItem original = store.State.AllTasks.Single();
        _ = await Assert.ThrowsExactlyAsync<Core.FacetEngineException.Conflict>(() =>
            store.RemoveProfileAsync("p", TestContext.CancellationToken)
        );
        Assert.AreEqual("p", store.SelectedProfileId);
        Assert.AreEqual(original.Id, store.State.AllTasks.Single().Id);
        Assert.AreEqual(1U, store.State.PendingCount);
        Assert.HasCount(1, store.Profiles);
        Assert.IsTrue(File.Exists(Path.Combine(fixture.Root, original.VaultPath!)));
        Assert.IsEmpty(new FacetProfileCatalog(fixture.StatePath).PendingRemovals);
    }

    /// <summary>Filename-mode rename reloads the primary applied identity; the next save fences its new path/revision.</summary>
    [TestMethod]
    public async Task FilenameTitleEditorUsesAppliedIdentityForASecondSave()
    {
        using Fixture fixture = new(frontmatterTitles: false);
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        await store.AddAsync("Original title", TaskListQuery.Today, TestContext.CancellationToken);
        TaskItem original = store.State.AllTasks.Single();
        using TaskEditorViewModel editor = new(store, new Dispatcher());
        editor.Load(original);
        HashSet<string> decisions = new(StringComparer.Ordinal);
        store.StateChanged += (_, _) =>
        {
            foreach (var pending in store.State.FacetPendingActions)
                decisions.Add(pending.Id);
        };
        editor.Title = "Renamed title";
        Assert.IsTrue(await editor.SaveAsync(TestContext.CancellationToken));
        TaskItem renamed = store.State.AllTasks.Single();
        Assert.AreNotEqual(original.Id, renamed.Id);
        Assert.AreEqual(renamed.Id, editor.TaskId);
        Assert.IsFalse(editor.IsDirty);
        Assert.IsFalse(File.Exists(Path.Combine(fixture.Root, original.VaultPath!)));
        string firstRevision = renamed.ExpectedRevision!;
        editor.Details = "Second edit targets the resulting note.";
        Assert.IsTrue(await editor.SaveAsync(TestContext.CancellationToken));
        TaskItem second = store.State.AllTasks.Single();
        Assert.AreEqual(renamed.Id, second.Id);
        Assert.AreEqual(second.Id, editor.TaskId);
        string secondRevision = second.ExpectedRevision!;
        Assert.AreNotEqual(firstRevision, secondRevision);
        Assert.AreEqual("Second edit targets the resulting note.", second.Details);
        Assert.IsFalse(editor.IsDirty);
        Assert.HasCount(2, decisions);
        Assert.IsEmpty(new FacetMutationJournal(fixture.StatePath).PendingEntries);
        await using FacetEngineService engine = FacetPortableCapability.Open(
            fixture.DatabasePath,
            [new FacetFolderCapability("p", fixture.Root, true)]
        );
        await engine.InitializeAsync(TestContext.CancellationToken);
        foreach (string id in decisions)
        {
            using var receipt = JsonDocument.Parse(
                await engine.FeaturesAsync(
                    "p",
                    JsonSerializer.Serialize(new { kind = "mutation_receipt", mutationId = id }),
                    TestContext.CancellationToken
                )
            );
            Assert.AreEqual("applied", receipt.RootElement.GetProperty("state").GetString());
            Assert.AreEqual(
                second.VaultPath,
                receipt.RootElement.GetProperty("receipt").GetProperty("taskPath").GetString()
            );
        }
    }

    /// <summary>Paged native reads retain the entire task corpus.</summary>
    [TestMethod]
    public async Task PagedTaskReadRetainsTheCompleteCorpus()
    {
        using Fixture fixture = new();
        for (int index = 0; index < 1001; index++)
            fixture.Seed(
                $"task-{index:D4}.md",
                "---\ntitle: Clocked\nstatus: open\npriority: normal\ndateCreated: '2026-10-03T12:00:00Z'\ntags: [task]\n---\n"
            );
        await using var store = fixture.Open(new AdvancingTime());
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        Assert.HasCount(1001, store.State.AllTasks);
    }

    /// <summary>Disposal fences new requests, preserves already accepted writes and shares one actual drain across callers.</summary>
    [TestMethod]
    public async Task DisposalWaitsForAcceptedAndQueuedNativeMutations()
    {
        using Fixture fixture = new();
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        TaskCompletionSource<bool> accepted = new(
            TaskCreationOptions.RunContinuationsAsynchronously
        );
        using ManualResetEventSlim release = new();
        store.StateChanged += (_, _) =>
        {
            if (store.State.FacetPendingActions.Count == 0)
                return;
            accepted.TrySetResult(true);
            release.Wait(CancellationToken.None);
        };
        Task first = Task.Run(
            () => store.AddAsync("Accepted", TaskListQuery.Today, TestContext.CancellationToken),
            TestContext.CancellationToken
        );
        try
        {
            await accepted.Task.WaitAsync(TestContext.CancellationToken);
            Task queued = store.AddAsync(
                "Already queued",
                TaskListQuery.Today,
                TestContext.CancellationToken
            );
            Task disposing = store.DisposeAsync().AsTask();
            Task duplicate = store.DisposeAsync().AsTask();
            Assert.AreSame(disposing, duplicate);
            Assert.IsFalse(disposing.IsCompleted);
            _ = await Assert.ThrowsExactlyAsync<ObjectDisposedException>(() =>
                store.AddAsync(
                    "Rejected after close",
                    TaskListQuery.Today,
                    TestContext.CancellationToken
                )
            );
            release.Set();
            await Task.WhenAll(first, queued, disposing, duplicate)
                .WaitAsync(TestContext.CancellationToken);
            CollectionAssert.AreEquivalent(
                ClosingWriteTitles,
                store.State.AllTasks.Select(task => task.Title).ToArray()
            );
            Assert.IsEmpty(new FacetMutationJournal(fixture.StatePath).PendingEntries);
            Assert.HasCount(
                2,
                Directory.GetFiles(fixture.Root, "*.md", SearchOption.AllDirectories)
            );
        }
        finally
        {
            release.Set();
        }
    }

    /// <summary>A configured editor transition changes content, stamps completion and is undone atomically.</summary>
    [TestMethod]
    public async Task ConfiguredEditorTransitionUsesOneCoreDecisionAndUndo()
    {
        using Fixture fixture = new();
        fixture.ConfigureWorkflow();
        fixture.Seed(
            "review.md",
            "---\ntitle: Review\nstatus: awaiting-review\npriority: exceptional\ndateCreated: '2026-10-03T12:00:00Z'\ntags: [task]\n---\nOriginal body\n"
        );
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        TaskItem original = store.State.AllTasks.Single();
        byte[] before = await File.ReadAllBytesAsync(
            Path.Combine(fixture.Root, "review.md"),
            TestContext.CancellationToken
        );
        using TaskEditorViewModel editor = new(store, new Dispatcher());
        editor.Load(original);
        editor.Title = "Approved from editor";
        editor.Details = "";
        editor.Status = "finished-verified";
        Assert.IsTrue(await editor.SaveAsync(TestContext.CancellationToken));
        TaskItem completed = store.State.AllTasks.Single();
        Assert.AreEqual("Approved from editor", completed.Title);
        Assert.AreEqual("finished-verified", completed.Status);
        Assert.IsTrue(completed.IsCompleted);
        Assert.AreEqual("", completed.Details);
        Assert.AreEqual(
            "2026-10-03T12:00:00Z",
            completed.Properties!.Value.GetProperty("dateCreated").GetString()
        );
        await using (
            FacetEngineService engine = FacetPortableCapability.Open(
                fixture.DatabasePath,
                [new FacetFolderCapability("p", fixture.Root, true)]
            )
        )
        {
            await engine.InitializeAsync(TestContext.CancellationToken);
            using var decision = JsonDocument.Parse(
                await engine.FeaturesAsync(
                    "p",
                    "{\"kind\":\"undo_available\"}",
                    TestContext.CancellationToken
                )
            );
            Assert.AreEqual(
                "edit_task",
                decision.RootElement.GetProperty("commandKind").GetString()
            );
            DateTimeOffset at = DateTimeOffset.Parse(
                decision.RootElement.GetProperty("at").GetString()!,
                CultureInfo.InvariantCulture
            );
            Assert.AreEqual(
                TimeZoneInfo
                    .ConvertTime(at, TimeZoneInfo.Local)
                    .ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                completed.Properties.Value.GetProperty("completedDate").GetString()
            );
        }
        await store.UndoCompletionAsync(TestContext.CancellationToken);
        CollectionAssert.AreEqual(
            before,
            await File.ReadAllBytesAsync(
                Path.Combine(fixture.Root, "review.md"),
                TestContext.CancellationToken
            )
        );
        Assert.AreEqual("awaiting-review", store.State.AllTasks.Single().Status);
    }

    /// <summary>New installations stay actionable while missing profile capabilities prevent domain writes.</summary>
    [TestMethod]
    public async Task UnconfiguredStoreRequiresAnOwningVaultBeforeAnyWrite()
    {
        using TemporaryDirectory directory = new();
        await using var store = FacetPortableCapability.Store(directory.Path, new EmptySecrets());
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        Assert.IsNull(store.SelectedProfileId);
        Assert.IsEmpty(store.Profiles);
        Assert.AreEqual(TaskNotesSyncState.Unconfigured, store.State.SyncState);
        await store.RefreshAsync(TestContext.CancellationToken);
        await store.SetQueryAsync(
            new TaskListQuery(TaskListKind.Browse),
            TestContext.CancellationToken
        );
        _ = await Assert.ThrowsExactlyAsync<InvalidOperationException>(() =>
            store.AddAsync("Cannot write", TaskListQuery.Today, TestContext.CancellationToken)
        );
        _ = await Assert.ThrowsExactlyAsync<InvalidOperationException>(() =>
            store.UndoCompletionAsync(TestContext.CancellationToken)
        );
        _ = await Assert.ThrowsExactlyAsync<InvalidOperationException>(() =>
            store.PreviewQuickAddAsync("Needs a vault", TestContext.CancellationToken)
        );
        Assert.IsEmpty(store.State.AllTasks);
        Assert.IsFalse(store.State.CanUndoCompletion);
    }

    /// <summary>Ambiguous retained Undo records and missing reviewed revisions are rejected before journal or file changes.</summary>
    [TestMethod]
    public async Task EditorAndUndoRejectUnreviewedIdentitiesBeforeNativeEffects()
    {
        using Fixture fixture = new();
        var journal = new FacetMutationJournal(fixture.StatePath);
        journal.Prepare("p", new { kind = "undo", receiptId = "first" });
        journal.Prepare("p", new { kind = "undo", receiptId = "second" });
        fixture.Seed(
            "reviewed.md",
            "---\ntitle: Reviewed\nstatus: open\npriority: normal\ndateCreated: '2026-10-03T12:00:00Z'\ntags: [task]\n---\nOriginal\n"
        );
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            store.UndoCompletionAsync(TestContext.CancellationToken)
        );
        Assert.HasCount(2, store.State.FacetPendingActions);
        using TaskEditorViewModel editor = new(store, new Dispatcher());
        editor.Load(store.State.AllTasks.Single() with { ExpectedRevision = null });
        editor.Title = "Draft";
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            editor.SaveAsync(TestContext.CancellationToken)
        );
        Assert.IsTrue(editor.IsDirty);
        Assert.AreEqual("Reviewed", store.State.AllTasks.Single().Title);
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            store.UpdateTaskAsync(
                new TaskEditInput
                {
                    Id = store.State.AllTasks.Single().Id,
                    Title = "Unreviewed full DTO",
                    Status = "done",
                    Priority = "normal",
                },
                TestContext.CancellationToken
            )
        );
        Assert.AreEqual("Reviewed", store.State.AllTasks.Single().Title);
        Assert.AreEqual(0u, store.State.PendingCount);
        Assert.HasCount(2, new FacetMutationJournal(fixture.StatePath).PendingEntries);
    }

    /// <summary>Incomplete historical metadata is preserved on rejection and repaired only with an explicit chosen timestamp.</summary>
    [TestMethod]
    public async Task MissingCreationMetadataPreservesDraftAndRequiresExplicitRepair()
    {
        using Fixture fixture = new();
        const string markdown =
            "---\ntitle: Historical\nstatus: open\npriority: normal\ntags: [task]\n---\nPreserve this history\n";
        fixture.Seed("historical.md", markdown);
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        using TaskEditorViewModel editor = new(store, new Dispatcher());
        editor.Load(store.State.AllTasks.Single());
        Assert.AreEqual("", editor.DateCreated);
        editor.Title = "Reviewed historical";
        var failure = await Assert.ThrowsExactlyAsync<Core.FacetEngineException.Validation>(() =>
            editor.SaveAsync(TestContext.CancellationToken)
        );
        StringAssert.Contains(failure.detail, "dateCreated", StringComparison.Ordinal);
        Assert.IsTrue(editor.IsDirty);
        Assert.AreEqual("Reviewed historical", editor.Title);
        Assert.AreEqual(
            markdown,
            await File.ReadAllTextAsync(
                Path.Combine(fixture.Root, "historical.md"),
                TestContext.CancellationToken
            )
        );
        Assert.AreEqual(0u, store.State.PendingCount);
        Assert.HasCount(1, store.State.FacetPendingActions);
        await store.RetireRejectedMutationAsync(
            store.State.FacetPendingActions.Single().Id,
            TestContext.CancellationToken
        );
        editor.DateCreated = "2020-02-03T04:05:06Z";
        Assert.IsTrue(await editor.SaveAsync(TestContext.CancellationToken));
        Assert.AreEqual(
            "2020-02-03T04:05:06Z",
            store.State.AllTasks.Single().Properties!.Value.GetProperty("dateCreated").GetString()
        );
        Assert.AreEqual("Preserve this history\n", store.State.AllTasks.Single().Details);
        Assert.AreEqual(1u, store.State.PendingCount);
    }

    /// <summary>Undo follows the eligible Rust head, while an ambiguous prior Undo resumes before touching its predecessor.</summary>
    [TestMethod]
    public async Task CoreUndoAuthorityResumesRetainedDecisionBeforeAnotherHead()
    {
        using Fixture fixture = new();
        string secondReceipt;
        await using (var store = fixture.Open())
        {
            await store.InitializeAsync(null, null, TestContext.CancellationToken);
            await store.AddAsync("First", TaskListQuery.Today, TestContext.CancellationToken);
            await store.AddAsync("Second", TaskListQuery.Today, TestContext.CancellationToken);
            Assert.AreEqual(0, store.State.CompletionUndoDepth);
            Assert.IsTrue(store.State.CanUndoCompletion);
            await using FacetEngineService engine = FacetPortableCapability.Open(
                fixture.DatabasePath,
                [new FacetFolderCapability("p", fixture.Root, true)]
            );
            await engine.InitializeAsync(TestContext.CancellationToken);
            using var available = JsonDocument.Parse(
                await engine.FeaturesAsync(
                    "p",
                    "{\"kind\":\"undo_available\"}",
                    TestContext.CancellationToken
                )
            );
            secondReceipt = available.RootElement.GetProperty("receiptId").GetString()!;
        }
        var undo = new FacetMutationJournal(fixture.StatePath).Prepare(
            "p",
            new { kind = "undo", receiptId = secondReceipt }
        );
        await fixture.ApplyOutsideHostObservationAsync(undo, TestContext.CancellationToken);
        await using (var store = fixture.Open())
        {
            await store.InitializeAsync(null, null, TestContext.CancellationToken);
            Assert.AreEqual("First", store.State.AllTasks.Single().Title);
            Assert.IsTrue(store.State.CanUndoCompletion);
            await store.UndoCompletionAsync(TestContext.CancellationToken);
            Assert.AreEqual("First", store.State.AllTasks.Single().Title);
            Assert.IsEmpty(store.State.FacetPendingActions);
            await store.UndoCompletionAsync(TestContext.CancellationToken);
            Assert.IsEmpty(store.State.AllTasks);
            Assert.IsFalse(store.State.CanUndoCompletion);
            _ = await Assert.ThrowsExactlyAsync<InvalidOperationException>(() =>
                store.UndoCompletionAsync(TestContext.CancellationToken)
            );
        }
    }

    /// <summary>Editor patches preserve untouched exact values and reject edits outside their reviewed vault/revision.</summary>
    [TestMethod]
    [DataRow("9007199254740993")]
    [DataRow("31.625")]
    [DataRow("null")]
    public async Task EditorPreservesExactPropertiesAndFencesOriginalOwnerAndRevision(
        string estimate
    )
    {
        using Fixture fixture = new();
        fixture.AddSecondProfile();
        fixture.Seed(
            "same.md",
            $"---\ntitle: Original\nstatus: open\npriority: normal\ndateCreated: '2026-10-03T12:00:00Z'\ntags: [task]\ntimeEstimate: {estimate}\nvendor:\n  nested: [true, 9007199254740993]\nreminders:\n  - id: reminder-original\n    type: absolute\n    absoluteTime: '2026-10-03T17:00:00Z'\n    vendor: {{keep: true}}\nattachments: ['[[file.pdf]]']\n---\nOriginal body\n"
        );
        await File.WriteAllTextAsync(
            Path.Combine(fixture.SecondRoot, "same.md"),
            "---\ntitle: Other vault\ntags: [task]\n---\nOther body\n",
            TestContext.CancellationToken
        );
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        using TaskEditorViewModel editor = new(store, new Dispatcher());
        TaskItem original = store.State.AllTasks.Single();
        editor.Load(original);
        string exactProperties = original.Properties!.Value.GetRawText();
        editor.Title = "Renamed";
        Assert.IsTrue(await editor.SaveAsync(TestContext.CancellationToken));
        TaskItem renamed = store.State.AllTasks.Single();
        using var before = JsonDocument.Parse(exactProperties);
        foreach (string key in new[] { "timeEstimate", "vendor", "reminders", "attachments" })
            Assert.AreEqual(
                before.RootElement.GetProperty(key).GetRawText(),
                renamed.Properties!.Value.GetProperty(key).GetRawText(),
                key
            );
        Assert.AreEqual(original.Details, renamed.Details);
        editor.Load(renamed);
        editor.Details = "Reviewed draft";
        await store.SelectProfileAsync("q", TestContext.CancellationToken);
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            editor.SaveAsync(TestContext.CancellationToken)
        );
        Assert.IsTrue(editor.IsDirty);
        Assert.AreEqual("Other vault", store.State.AllTasks.Single().Title);
        await store.SelectProfileAsync("p", TestContext.CancellationToken);
        fixture.Seed(
            "same.md",
            await File.ReadAllTextAsync(
                Path.Combine(fixture.Root, "same.md"),
                TestContext.CancellationToken
            ) + "Remote edit\n"
        );
        await store.RefreshAsync(TestContext.CancellationToken);
        _ = await Assert.ThrowsExactlyAsync<Core.FacetEngineException.Conflict>(() =>
            editor.SaveAsync(TestContext.CancellationToken)
        );
        Assert.IsTrue(editor.IsDirty);
        Assert.AreEqual("Reviewed draft", editor.Details);
        StringAssert.Contains(
            await File.ReadAllTextAsync(
                Path.Combine(fixture.Root, "same.md"),
                TestContext.CancellationToken
            ),
            "Remote edit",
            StringComparison.Ordinal
        );
        Assert.HasCount(1, store.State.FacetPendingActions);
        await store.RetireRejectedMutationAsync(
            store.State.FacetPendingActions.Single().Id,
            TestContext.CancellationToken
        );
        editor.Load(store.State.AllTasks.Single());
        editor.Reminders.Single().AbsoluteTime = "2026-10-04T17:00:00Z";
        editor.Attachments += "\n[[second.pdf]]";
        editor.CompletedDate = "2026-10-03";
        editor.CompleteInstances = "2026-10-03";
        editor.SkippedInstances = "2026-10-04";
        Assert.IsTrue(await editor.SaveAsync(TestContext.CancellationToken));
        JsonElement properties = store.State.AllTasks.Single().Properties!.Value;
        Assert.AreEqual(estimate, properties.GetProperty("timeEstimate").GetRawText());
        Assert.IsTrue(
            properties
                .GetProperty("reminders")[0]
                .GetProperty("vendor")
                .GetProperty("keep")
                .GetBoolean()
        );
        Assert.AreEqual(
            "2026-10-04T17:00:00Z",
            properties.GetProperty("reminders")[0].GetProperty("absoluteTime").GetString()
        );
        Assert.AreEqual("[[second.pdf]]", properties.GetProperty("attachments")[1].GetString());
        Assert.AreEqual("2026-10-04", properties.GetProperty("skippedInstances")[0].GetString());
    }

    /// <summary>Restart-restored creates/completions/Undo replay the same owning envelope before private cleanup.</summary>
    [TestMethod]
    public async Task RestoredActionsResumeOnlyTheirOriginalProfileAndReconcileUndo()
    {
        using Fixture fixture = new();
        fixture.AddSecondProfile();
        var journal = new FacetMutationJournal(fixture.StatePath);
        var create = journal.Prepare(
            "p",
            new
            {
                kind = "create",
                path = "recovered.md",
                properties = new { title = "Recovered" },
            }
        );
        var other = journal.Prepare(
            "q",
            new
            {
                kind = "create",
                path = "other.md",
                properties = new { title = "Another vault" },
            }
        );
        await using (var store = fixture.Open())
        {
            await store.InitializeAsync(null, null, TestContext.CancellationToken);
            using FacetSettingsViewModel settings = new(store, store, new Dispatcher());
            await settings.ReloadAsync(TestContext.CancellationToken);
            Assert.HasCount(2, settings.PendingActions);
            Assert.IsEmpty(store.State.AllTasks);
            _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
                settings.ResumeAsync(other.Id, TestContext.CancellationToken)
            );
            Assert.IsFalse(File.Exists(Path.Combine(fixture.SecondRoot, "other.md")));
            await settings.ResumeAsync(create.Id, TestContext.CancellationToken);
            Assert.AreEqual("Recovered", store.State.AllTasks.Single().Title);
            Assert.AreEqual(other.Id, settings.PendingActions.Single().Id);
            _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
                settings.ResumeAsync(create.Id, TestContext.CancellationToken)
            );
            Assert.HasCount(1, store.State.AllTasks);
        }
        var complete = new FacetMutationJournal(fixture.StatePath).Prepare(
            "p",
            new
            {
                kind = "set_completion",
                path = "recovered.md",
                completed = true,
            }
        );
        await using (
            FacetEngineService engine = FacetPortableCapability.Open(
                fixture.DatabasePath,
                [new FacetFolderCapability("p", fixture.Root, true)]
            )
        )
        {
            await engine.InitializeAsync(TestContext.CancellationToken);
            await engine.ExecuteAsync("p", complete.Document, TestContext.CancellationToken);
        }
        await using (var store = fixture.Open())
        {
            await store.InitializeAsync(null, null, TestContext.CancellationToken);
            using FacetSettingsViewModel settings = new(store, store, new Dispatcher());
            Assert.IsTrue(store.State.AllTasks.Single().IsCompleted);
            Assert.AreEqual(0, store.State.CompletionUndoDepth);
            _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
                settings.RetireRejectedAsync(complete.Id, TestContext.CancellationToken)
            );
            await settings.ResumeAsync(complete.Id, TestContext.CancellationToken);
            Assert.AreEqual(1, store.State.CompletionUndoDepth);
            Assert.AreEqual(other.Id, settings.PendingActions.Single().Id);
        }
        var undo = new FacetMutationJournal(fixture.StatePath).Prepare(
            "p",
            new { kind = "undo", receiptId = complete.Id }
        );
        await fixture.ApplyOutsideHostObservationAsync(undo, TestContext.CancellationToken);
        await using (var store = fixture.Open())
        {
            await store.InitializeAsync(null, null, TestContext.CancellationToken);
            using FacetSettingsViewModel settings = new(store, store, new Dispatcher());
            Assert.IsFalse(store.State.AllTasks.Single().IsCompleted);
            await settings.ResumeAsync(undo.Id, TestContext.CancellationToken);
            Assert.AreEqual(0, store.State.CompletionUndoDepth);
            _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
                settings.ResumeAsync(undo.Id, TestContext.CancellationToken)
            );
            await settings.SelectAsync("q", TestContext.CancellationToken);
            await settings.RetireRejectedAsync(other.Id, TestContext.CancellationToken);
            Assert.IsEmpty(settings.PendingActions);
            Assert.IsEmpty(store.State.AllTasks);
        }
    }

    /// <summary>Configured date/priority groups and all report periods retain native projections and reject invalid selectors.</summary>
    [TestMethod]
    public async Task DateQueriesReachEveryPresentationSelector()
    {
        using Fixture fixture = new();
        var civilDay = new DateTime(2026, 10, 3);
        var civilEnd = civilDay.AddHours(12);
        var end = new DateTimeOffset(civilEnd, TimeZoneInfo.Local.GetUtcOffset(civilEnd));
        var clock = new FixedTime(end.AddHours(1));
        string today = civilDay.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        string future = civilDay.AddDays(2).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        fixture.Seed(
            "today.md",
            $"---\ntitle: Today\nstatus: open\npriority: normal\ntags: [task]\nprojects: [Work]\ncontexts: [desk]\ndue: {today}\n---\n"
        );
        fixture.Seed(
            "future.md",
            $"---\ntitle: Future\nstatus: open\npriority: high\ntags: [task]\nprojects: [Work]\ncontexts: [desk]\ndue: {future}\n---\n"
        );
        await using var store = fixture.Open(clock);
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        foreach (
            var (sort, group) in new[]
            {
                (TaskSortChoice.DueDate, TaskGroupChoice.Date),
                (TaskSortChoice.Priority, TaskGroupChoice.Priority),
                (TaskSortChoice.EffectiveDate, TaskGroupChoice.Project),
                (TaskSortChoice.AsSynchronized, TaskGroupChoice.None),
            }
        )
        {
            await store.SetQueryAsync(
                new TaskListQuery(TaskListKind.Browse)
                {
                    Sort = sort,
                    Group = group,
                    Descending = true,
                },
                TestContext.CancellationToken
            );
            Assert.HasCount(2, store.State.VisibleTasks);
            Assert.IsTrue(
                store.State.VisibleTasks.All(t =>
                    t.Projects.Single() == "Work" && t.Contexts.Single() == "desk"
                )
            );
        }
        await store.SetQueryAsync(
            new TaskListQuery(TaskListKind.Upcoming),
            TestContext.CancellationToken
        );
        Assert.AreEqual("Future", store.State.VisibleTasks.Single().Title);
        await store.SetQueryAsync(
            new TaskListQuery(TaskListKind.Browse) { HasNoDueDate = true },
            TestContext.CancellationToken
        );
        Assert.IsEmpty(store.State.VisibleTasks);
        foreach (
            TaskListKind kind in new[]
            {
                TaskListKind.Project,
                TaskListKind.Context,
                TaskListKind.Tag,
            }
        )
            _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
                store.SetQueryAsync(new TaskListQuery(kind), TestContext.CancellationToken)
            );
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            store.SetQueryAsync(
                new TaskListQuery(TaskListKind.Browse) { Sort = (TaskSortChoice)int.MaxValue },
                TestContext.CancellationToken
            )
        );
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            store.SetQueryAsync(
                new TaskListQuery(TaskListKind.Browse) { Group = (TaskGroupChoice)int.MaxValue },
                TestContext.CancellationToken
            )
        );
    }

    /// <summary>Core NLP and contextual capture create real notes across all dynamic list dimensions.</summary>
    [TestMethod]
    public async Task ContextualCaptureAndVocabularyQueriesReachNativePolicy()
    {
        using Fixture fixture = new();
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        var preview = await store.PreviewQuickAddAsync(
            "Captured tomorrow",
            TestContext.CancellationToken
        );
        Assert.AreEqual("Captured", preview.Title);
        Assert.AreEqual(
            DateTime.Today.AddDays(1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            preview.Due
        );
        await store.AddAsync(
            "Context task",
            new TaskListQuery(TaskListKind.Context, "review desk"),
            TestContext.CancellationToken
        );
        await store.AddAsync(
            "Tag task",
            new TaskListQuery(TaskListKind.Tag, "review-tag"),
            TestContext.CancellationToken
        );
        await store.SetQueryAsync(
            new TaskListQuery(TaskListKind.Context, "review desk"),
            TestContext.CancellationToken
        );
        Assert.AreEqual("Context task", store.State.VisibleTasks.Single().Title);
        Assert.AreEqual("review desk", store.State.VisibleTasks.Single().Contexts.Single());
        await store.SetQueryAsync(
            new TaskListQuery(TaskListKind.Tag, "review-tag"),
            TestContext.CancellationToken
        );
        Assert.AreEqual("Tag task", store.State.VisibleTasks.Single().Title);
        Assert.Contains("review-tag", store.State.VisibleTasks.Single().Tags);
        await store.SetQueryAsync(
            new TaskListQuery(TaskListKind.Inbox),
            TestContext.CancellationToken
        );
        Assert.IsFalse(store.State.VisibleTasks.Any(t => t.Title == "Context task"));
    }

    /// <summary>Typed replacement decisions retain immutable archived versions and replay exact receipts.</summary>
    [TestMethod]
    public async Task TypedConflictReplacementAndHistorySurviveNativeReplay()
    {
        using Fixture fixture = new();
        await fixture.SeedConflictsAsync(1, TestContext.CancellationToken);
        await using FacetEngineService engine = FacetPortableCapability.Open(
            fixture.DatabasePath,
            [new FacetFolderCapability("p", fixture.Root, true)]
        );
        await engine.InitializeAsync(TestContext.CancellationToken);
        using var page = JsonDocument.Parse(
            await engine.ConflictsAsync("p", TestContext.CancellationToken)
        );
        var conflict = page.RootElement.GetProperty("conflicts")[0];
        string id = conflict.GetProperty("id").GetString()!;
        string? Version(string name) =>
            conflict.GetProperty(name).ValueKind == JsonValueKind.Null
                ? null
                : conflict.GetProperty(name).GetProperty("revision").GetString();
        string mutation = JsonSerializer.Serialize(
            new
            {
                schemaVersion = 1,
                mutationId = "typed-resolution",
                at = "2026-10-03T12:01:00Z",
                command = new
                {
                    kind = "resolve_conflict",
                    conflictId = id,
                    expectedRevisions = new
                    {
                        @base = Version("base"),
                        local = Version("local"),
                        remote = Version("remote"),
                        current = conflict.GetProperty("currentRevision").GetString(),
                    },
                    resolution = new { kind = "replace_payload", deleted = false },
                },
            }
        );
        byte[] replacement = Encoding.UTF8.GetBytes(
            "---\ntitle: Reviewed\nstatus: open\npriority: normal\ndateCreated: '2026-10-03T12:00:00Z'\ntags: [task]\n---\n"
                + new string('x', 128_000)
        );
        string receipt = await engine.ExecutePayloadAsync(
            "p",
            mutation,
            replacement,
            TestContext.CancellationToken
        );
        using var applied = JsonDocument.Parse(receipt);
        Assert.IsTrue(applied.RootElement.GetProperty("applied").GetBoolean());
        Assert.AreEqual(
            receipt,
            await engine.ExecutePayloadAsync(
                "p",
                mutation,
                replacement,
                TestContext.CancellationToken
            )
        );
        CollectionAssert.AreEqual(
            replacement,
            await File.ReadAllBytesAsync(
                Path.Combine(fixture.Root, "Tasks/conflict-000.md"),
                TestContext.CancellationToken
            )
        );
        using var state = JsonDocument.Parse(
            await engine.FeaturesAsync(
                "p",
                "{\"kind\":\"mutation_receipt\",\"mutationId\":\"typed-resolution\"}",
                TestContext.CancellationToken
            )
        );
        Assert.AreEqual("applied", state.RootElement.GetProperty("state").GetString());
        using var history = JsonDocument.Parse(
            await engine.FeaturesAsync(
                "p",
                "{\"kind\":\"resolution_history\",\"mutationId\":\"typed-resolution\"}",
                TestContext.CancellationToken
            )
        );
        Assert.AreEqual(id, history.RootElement.GetProperty("originalConflictId").GetString());
        foreach (string version in new[] { "base", "local", "remote" })
            CollectionAssert.AreEqual(
                fixture.ConflictBytes[version],
                await engine.ReadConflictPayloadAsync(
                    "p",
                    "archive:typed-resolution",
                    version,
                    TestContext.CancellationToken
                )
            );
        _ = await Assert.ThrowsExactlyAsync<Core.FacetEngineException.Validation>(() =>
            engine.ExecutePayloadAsync(
                "p",
                mutation,
                "different"u8.ToArray(),
                TestContext.CancellationToken
            )
        );
        using var absent = JsonDocument.Parse(
            await engine.FeaturesAsync(
                "p",
                "{\"kind\":\"mutation_receipt\",\"mutationId\":\"unsubmitted\"}",
                TestContext.CancellationToken
            )
        );
        Assert.AreEqual("absent", absent.RootElement.GetProperty("state").GetString());
        await engine.ExecuteAsync(
            "p",
            "{\"mutationId\":\"undo-resolution\",\"at\":\"2026-10-03T12:02:00Z\",\"command\":{\"kind\":\"undo\",\"receiptId\":\"typed-resolution\"}}",
            TestContext.CancellationToken
        );
        using var restored = JsonDocument.Parse(
            await engine.ConflictsAsync("p", TestContext.CancellationToken)
        );
        Assert.AreEqual(
            id,
            restored.RootElement.GetProperty("conflicts")[0].GetProperty("id").GetString()
        );
    }

    /// <summary>External Obsidian edits produce real conflict pages, lazy retained bytes and fenced native resolution.</summary>
    [TestMethod]
    public async Task RetainedConflictPagesAndLazyPayloadsReachTheProductionStore()
    {
        using Fixture fixture = new();
        await fixture.SeedConflictsAsync(
            129,
            TestContext.CancellationToken,
            message => TestContext.WriteLine(message),
            externalLocalEdits: true
        );
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        var conflicts = await store.ConflictsAsync(TestContext.CancellationToken);
        Assert.HasCount(129, conflicts);
        Assert.HasCount(129, store.State.FacetConflicts);
        Assert.AreEqual(129, conflicts.Select(c => c.Id).Distinct(StringComparer.Ordinal).Count());
        var conflict = conflicts.Single(c => c.Path == "Tasks/conflict-000.md");
        Assert.IsNotNull(conflict.Base);
        Assert.IsNotNull(conflict.Local);
        Assert.IsNotNull(conflict.Remote);
        foreach (string version in new[] { "base", "local", "remote" })
        {
            byte[]? payload = await store.ReadConflictPayloadAsync(
                conflict.Id,
                version,
                TestContext.CancellationToken
            );
            Assert.IsNotNull(payload);
            CollectionAssert.AreEqual(fixture.ConflictBytes[version], payload);
        }
        await store.ResolveConflictAsync(conflict.Id, "keep_local", TestContext.CancellationToken);
        Assert.HasCount(128, store.State.FacetConflicts);
        Assert.IsFalse(store.State.FacetConflicts.Any(c => c.Id == conflict.Id));
        var resolved = store.State.AllTasks.Single(t => t.Title == "local");
        StringAssert.Contains(resolved.Id, conflict.Path, StringComparison.Ordinal);
        Assert.IsTrue(resolved.IsPending);
        var stale = conflicts.Single(c => c.Path == "Tasks/conflict-001.md");
        await File.AppendAllTextAsync(
            Path.Combine(fixture.Root, stale.Path),
            "External competing edit",
            TestContext.CancellationToken
        );
        _ = await Assert.ThrowsExactlyAsync<Core.FacetEngineException.Conflict>(() =>
            store.ResolveConflictAsync(stale.Id, "keep_remote", TestContext.CancellationToken)
        );
        Assert.HasCount(128, store.State.FacetConflicts);
        await store.RefreshAsync(TestContext.CancellationToken);
        await store.ResolveConflictAsync(stale.Id, "keep_remote", TestContext.CancellationToken);
        Assert.HasCount(127, store.State.FacetConflicts);
        Assert.IsFalse(
            (
                await File.ReadAllTextAsync(
                    Path.Combine(fixture.Root, stale.Path),
                    TestContext.CancellationToken
                )
            ).Contains("External competing edit", StringComparison.Ordinal)
        );
    }

    /// <summary>All editable fields, completion, grouped undo and bulk writes survive restore.</summary>
    [TestMethod]
    public async Task NativeTaskMutationsAndUndoPersistWithoutAServer()
    {
        using Fixture fixture = new();
        string today = DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        await using (var store = fixture.Open())
        {
            await store.InitializeAsync(null, null, TestContext.CancellationToken);
            await store.AddAsync("First", TaskListQuery.Today, TestContext.CancellationToken);
            await store.AddAsync(
                "Second",
                new TaskListQuery(TaskListKind.Project, "Quality"),
                TestContext.CancellationToken
            );
            Assert.HasCount(2, store.State.AllTasks);
            var first = store.State.AllTasks.Single(t => t.Title == "First");
            var second = store.State.AllTasks.Single(t => t.Title == "Second");
            Assert.AreEqual(today, first.Scheduled);
            Assert.AreEqual("Quality", second.Projects.Single());
            using TaskEditorViewModel editor = new(store, new Dispatcher());
            editor.Load(first);
            editor.Title = "Edited";
            editor.Details = "Body **preserved**";
            editor.Status = "open";
            editor.Priority = "high";
            editor.Due = today;
            editor.Scheduled = today;
            editor.Projects = "Work";
            editor.Contexts = "desktop";
            editor.Tags = "task, quality";
            Assert.IsTrue(await editor.SaveAsync(TestContext.CancellationToken));
            Assert.AreEqual(
                "Body **preserved**",
                store.State.AllTasks.Single(t => t.Id == first.Id).Details?.Trim()
            );
            await store.SetQueryAsync(
                new TaskListQuery(TaskListKind.Project, "Quality"),
                TestContext.CancellationToken
            );
            Assert.HasCount(1, store.State.VisibleTasks);
            Assert.HasCount(1, store.State.TodayTasks);
            await store.CompleteRowsAsync(
                store.State.AllTasks.ToArray(),
                TestContext.CancellationToken
            );
            Assert.IsTrue(store.State.AllTasks.All(t => t.IsCompleted));
            Assert.AreEqual(1, store.State.CompletionUndoDepth);
            await store.UndoCompletionAsync(TestContext.CancellationToken);
            Assert.IsFalse(store.State.AllTasks.Any(t => t.IsCompleted));
            Assert.AreEqual(0, store.State.CompletionUndoDepth);
            await store.ScheduleRowsAsync(
                store.State.AllTasks.ToArray(),
                today,
                TestContext.CancellationToken
            );
            await store.PrioritizeRowsAsync(
                store.State.AllTasks.ToArray(),
                "low",
                TestContext.CancellationToken
            );
            Assert.IsTrue(
                store.State.AllTasks.All(t =>
                    t.Priority == "low" && t.Scheduled == today && t.IsPending
                )
            );
            Assert.HasCount(2, store.State.PendingIds);
            await store.SetRowCompletionAsync(
                store.State.AllTasks.Single(task => task.Id == first.Id),
                true,
                TestContext.CancellationToken
            );
        }
        await using (var restored = fixture.Open())
        {
            await restored.InitializeAsync(null, null, TestContext.CancellationToken);
            Assert.AreEqual("p", restored.SelectedProfileId);
            Assert.AreEqual(1, restored.State.CompletionUndoDepth);
            await restored.UndoCompletionAsync(TestContext.CancellationToken);
            Assert.IsFalse(restored.State.AllTasks.Any(t => t.IsCompleted));
            await restored.DeleteRowsAsync(
                restored.State.AllTasks.ToArray(),
                TestContext.CancellationToken
            );
            Assert.IsEmpty(restored.State.AllTasks);
        }
        Assert.IsEmpty(Directory.GetFiles(fixture.Root, "*.md", SearchOption.AllDirectories));
    }

    /// <summary>Multiple native pages retain every group and configured workflow strings.</summary>
    [TestMethod]
    public async Task PaginationRetainsGroupsAndOpenWorkflowValues()
    {
        using Fixture fixture = new();
        fixture.ConfigureWorkflow();
        for (int index = 0; index < 1005; index++)
            fixture.Seed(
                $"task-{index:D4}.md",
                $"---\ntitle: Task {index:D4}\nstatus: awaiting-review\npriority: exceptional\ndateCreated: '2026-10-03T12:00:00Z'\ntags: [task]\n---\n"
            );
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        using ShellViewModel shell = new(
            store,
            new Dispatcher(),
            NullLogger<ShellViewModel>.Instance
        );
        using TaskEditorViewModel editor = new(store, new Dispatcher());
        Assert.AreEqual("awaiting-review", shell.BoardColumns[0].Value);
        Assert.AreEqual("Review", shell.BoardColumns[0].Label);
        Assert.AreEqual(
            AutomationIds.BoardColumn("awaiting-review"),
            shell.BoardColumns[0].AutomationId
        );
        Assert.HasCount(1005, shell.BoardColumns[0].Tasks);
        Assert.AreEqual("awaiting-review", editor.StatusChoices[0].Value);
        Assert.AreEqual("exceptional", editor.PriorityChoices.Single().Value);
        await store.SetQueryAsync(
            new TaskListQuery(TaskListKind.Browse)
            {
                Group = TaskGroupChoice.Status,
                Sort = TaskSortChoice.Title,
            },
            TestContext.CancellationToken
        );
        Assert.HasCount(1005, store.State.VisibleTasks);
        Assert.IsTrue(
            store.State.VisibleTasks.All(t =>
                t.GroupLabel == "awaiting-review"
                && t.Status == "awaiting-review"
                && t.Priority == "exceptional"
            )
        );
        Assert.AreEqual(
            "Review",
            store.State.StatusChoices.Single(s => s.Value == "awaiting-review").Label
        );
        await store.SetStatusAsync(
            store.State.AllTasks[0].Id,
            "finished-verified",
            TestContext.CancellationToken
        );
        Assert.IsTrue(
            store.State.AllTasks.Single(t => t.Id == store.State.AllTasks[0].Id).IsCompleted
        );
        Assert.HasCount(1, shell.BoardColumns.Single(c => c.Value == "finished-verified").Tasks);
        await store.SetQueryAsync(
            new TaskListQuery(TaskListKind.Completed) { Search = "Task 0000" },
            TestContext.CancellationToken
        );
        Assert.HasCount(1, store.State.VisibleTasks);
    }

    /// <summary>Saved query lifecycle uses the production core.</summary>
    [TestMethod]
    public async Task SavedViewsPersistThroughTheFacade()
    {
        using Fixture fixture = new();
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        await store.AddAsync(
            "Timed",
            new TaskListQuery(TaskListKind.Project, "Quality"),
            TestContext.CancellationToken
        );
        string id = store.State.AllTasks.Single().Id;
        var view = await store.CreateSavedViewAsync(
            "Quality work",
            "Filter",
            "Accent",
            true,
            new TaskListQuery(TaskListKind.Project, "Quality") { Group = TaskGroupChoice.Priority },
            TestContext.CancellationToken
        );
        await store.SetQueryAsync(
            new TaskListQuery(TaskListKind.SavedView, view.Id),
            TestContext.CancellationToken
        );
        Assert.HasCount(1, store.State.VisibleTasks);
        await store.UpdateSavedViewAsync(
            view with
            {
                Name = "Renamed",
                IsFavorite = false,
            },
            TestContext.CancellationToken
        );
        var copy = await store.DuplicateSavedViewAsync(view.Id, TestContext.CancellationToken);
        await store.MoveSavedViewAsync(copy.Id, 0, TestContext.CancellationToken);
        Assert.AreEqual(copy.Id, store.State.SavedViews[0].Id);
        await store.DeleteSavedViewAsync(view.Id, TestContext.CancellationToken);
        Assert.HasCount(1, store.State.SavedViews);
    }

    /// <summary>Revoking a capability preserves the cached complete index and denies mutations.</summary>
    [TestMethod]
    public async Task CachedRestartSurvivesMissingCapabilityAndExternalFoldersRemainReadOnly()
    {
        using Fixture fixture = new();
        fixture.Seed(
            "existing.md",
            "---\ntitle: Existing\nstatus: open\npriority: normal\ntags: [task]\n---\nBody\n"
        );
        await using (var initial = fixture.Open())
            await initial.InitializeAsync(null, null, TestContext.CancellationToken);
        string moved = fixture.Root + "-revoked";
        Directory.Move(fixture.Root, moved);
        try
        {
            await using var restored = fixture.Open();
            await restored.InitializeAsync(null, null, TestContext.CancellationToken);
            Assert.AreEqual("Existing", restored.State.AllTasks.Single().Title);
            Assert.IsNotNull(restored.State.UserFacingError);
            _ = await Assert.ThrowsExactlyAsync<Core.FacetEngineException.Host>(() =>
                restored.DeleteTaskAsync(
                    restored.State.AllTasks.Single().Id,
                    TestContext.CancellationToken
                )
            );
        }
        finally
        {
            Directory.Move(moved, fixture.Root);
        }
        FacetVaultFiles files = new();
        files.Register("external", fixture.Root);
        _ = Assert.ThrowsExactly<Core.FacetHostException.PermissionDenied>(() =>
            files.CompareExchange("external", "existing.md", null, null)
        );
    }

    private sealed class Fixture : IDisposable
    {
        private readonly TemporaryDirectory _temporary = new();
        private readonly string _state;
        internal string Root { get; }
        internal string DatabasePath => Path.Combine(_state, "facet.sqlite");
        internal string StatePath => _state;
        internal string SecondRoot => Root + "-second";

        internal void AddSecondProfile()
        {
            Directory.CreateDirectory(SecondRoot);
            string configuration = Path.Combine(
                SecondRoot,
                ".obsidian",
                "plugins",
                "tasknotes",
                "data.json"
            );
            Directory.CreateDirectory(Path.GetDirectoryName(configuration)!);
            File.WriteAllText(configuration, "{\"storeTitleInFilename\":false}");
            var catalog = new FacetProfileCatalog(_state);
            catalog.Add(
                new FacetProfileRegistration(
                    "q",
                    "Second",
                    SecondRoot,
                    true,
                    true,
                    "fixture-owner",
                    new ObsidianVaultChoice(
                        "fixture-vault-2",
                        "Second",
                        "sync.obsidian.md",
                        "",
                        "fixture",
                        0,
                        false,
                        false
                    )
                )
            );
            catalog.Select("p");
        }

        internal Dictionary<string, byte[]> ConflictBytes { get; } = new(StringComparer.Ordinal);

        internal Fixture(bool frontmatterTitles = true)
        {
            string physical =
                OperatingSystem.IsMacOS()
                && _temporary.Path.StartsWith("/var/", StringComparison.Ordinal)
                    ? "/private" + _temporary.Path
                    : _temporary.Path;
            _state = Path.Combine(physical, "state");
            Root = Path.Combine(physical, "replica");
            Directory.CreateDirectory(Root);
            if (frontmatterTitles)
                Seed(".obsidian/plugins/tasknotes/data.json", "{\"storeTitleInFilename\":false}");
            new FacetProfileCatalog(_state).Add(
                new FacetProfileRegistration(
                    "p",
                    "Fixture",
                    Root,
                    true,
                    true,
                    "fixture-owner",
                    new ObsidianVaultChoice(
                        "fixture-vault",
                        "Fixture",
                        "sync.obsidian.md",
                        "",
                        "fixture",
                        0,
                        false,
                        false
                    )
                )
            );
        }

        internal FacetTaskNotesStore Open(TimeProvider? time = null) =>
            FacetPortableCapability.Store(_state, new EmptySecrets(), null, null, time);

        internal async Task ApplyOutsideHostObservationAsync(
            FacetMutationJournal.Entry entry,
            CancellationToken cancellationToken
        )
        {
            await using FacetEngineService engine = FacetPortableCapability.Open(
                DatabasePath,
                [new FacetFolderCapability("p", Root, true)]
            );
            await engine.InitializeAsync(cancellationToken);
            await engine.ExecuteAsync("p", entry.Document, cancellationToken);
        }

        internal async Task SeedConflictsAsync(
            int count,
            CancellationToken cancellationToken,
            Action<string>? progress = null,
            bool externalLocalEdits = false
        )
        {
            var elapsed = System.Diagnostics.Stopwatch.StartNew();
            await using FacetEngineService engine = FacetPortableCapability.Open(
                Path.Combine(_state, "facet.sqlite"),
                [new FacetFolderCapability("p", Root, true)]
            );
            await engine.InitializeAsync(cancellationToken);
            await engine.RegisterProfileAsync("p", "Fixture", Root, true, true, cancellationToken);
            await engine.RefreshAsync("p", cancellationToken);
            await using var remote = await FacetRemoteFixture.OpenAsync(
                engine,
                "p",
                cancellationToken
            );
            for (int index = 0; index < count; index++)
            {
                string path = $"Tasks/conflict-{index:D3}.md";
                string metadata = JsonSerializer.Serialize(
                    new
                    {
                        schemaVersion = 1,
                        uid = index + 1,
                        ctime = 1000,
                        mtime = 2000,
                    }
                );
                await remote.ApplyAsync(path, Markdown("base"), metadata, cancellationToken);
                if (index % 16 == 0)
                    progress?.Invoke(
                        $"base imports={index + 1}; elapsedMs={elapsed.ElapsedMilliseconds}"
                    );
            }
            progress?.Invoke($"base imports complete; elapsedMs={elapsed.ElapsedMilliseconds}");
            if (externalLocalEdits)
            {
                // This volume scenario represents edits made by Obsidian or
                // another vault writer. Native mutation journals have separate
                // actual-engine batch/Undo coverage and remain the default here.
                for (int index = 0; index < count; index++)
                    await File.WriteAllBytesAsync(
                        Path.Combine(Root, $"Tasks/conflict-{index:D3}.md"),
                        Markdown("local"),
                        cancellationToken
                    );
                await engine.RefreshAsync("p", cancellationToken);
                progress?.Invoke(
                    $"external local edits refreshed; elapsedMs={elapsed.ElapsedMilliseconds}"
                );
            }
            else
            {
                await engine.ExecuteAsync(
                    "p",
                    JsonSerializer.Serialize(
                        new
                        {
                            schemaVersion = 1,
                            mutationId = "local-conflict-fixture",
                            at = "2026-10-03T12:00:00Z",
                            command = new
                            {
                                kind = "batch",
                                commands = Enumerable
                                    .Range(0, count)
                                    .Select(index => new
                                    {
                                        kind = "update",
                                        path = $"Tasks/conflict-{index:D3}.md",
                                        properties = new { title = "local" },
                                    })
                                    .ToArray(),
                            },
                        }
                    ),
                    cancellationToken
                );
                progress?.Invoke(
                    $"local atomic batch complete; elapsedMs={elapsed.ElapsedMilliseconds}"
                );
            }
            for (int index = 0; index < count; index++)
            {
                string path = $"Tasks/conflict-{index:D3}.md";
                if (index == 0)
                {
                    ConflictBytes.Add("base", Markdown("base"));
                    ConflictBytes.Add(
                        "local",
                        await File.ReadAllBytesAsync(Path.Combine(Root, path), cancellationToken)
                    );
                    ConflictBytes.Add("remote", Markdown("remote"));
                }
                string metadata = JsonSerializer.Serialize(
                    new
                    {
                        schemaVersion = 1,
                        uid = count + index + 1,
                        ctime = 1000,
                        mtime = 3000,
                    }
                );
                await remote.ApplyAsync(path, Markdown("remote"), metadata, cancellationToken);
                if (index % 16 == 0)
                    progress?.Invoke(
                        $"remote conflicts={index + 1}; elapsedMs={elapsed.ElapsedMilliseconds}"
                    );
            }
            progress?.Invoke($"remote conflicts complete; elapsedMs={elapsed.ElapsedMilliseconds}");
        }

        private static byte[] Markdown(string title) =>
            Encoding.UTF8.GetBytes(
                $"---\ntitle: {title}\nstatus: open\npriority: normal\ndateCreated: '2026-10-03T12:00:00Z'\ntags: [task]\n---\nbase\n"
            );

        internal void Seed(string path, string text)
        {
            string target = Path.Combine(Root, path);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.WriteAllText(target, text);
        }

        internal void ConfigureWorkflow() =>
            Seed(
                ".obsidian/plugins/tasknotes/data.json",
                """
                {"storeTitleInFilename":false,"customStatuses":[{"id":"review","value":"awaiting-review","label":"Review","color":"#123456","isCompleted":false,"order":0},{"id":"finished","value":"finished-verified","label":"Verified","color":"#123456","isCompleted":true,"order":1}],"customPriorities":[{"id":"exceptional","value":"exceptional","label":"Exceptional","color":"#123456","weight":1}],"defaultTaskStatus":"awaiting-review","defaultTaskPriority":"exceptional"}
                """
            );

        public void Dispose() => _temporary.Dispose();
    }

    private sealed class FixedTime(DateTimeOffset instant) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => instant.ToUniversalTime();
    }

    private sealed class ObservationFaultTime : TimeProvider
    {
        internal bool FailNextRead { get; set; }

        public override DateTimeOffset GetUtcNow()
        {
            if (FailNextRead)
            {
                FailNextRead = false;
                throw new IOException("Expected component clock observation failure.");
            }
            return new DateTimeOffset(2026, 10, 7, 12, 0, 0, TimeSpan.Zero);
        }
    }

    private sealed class AdvancingTime : TimeProvider
    {
        private int _reads;
        public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;

        public override DateTimeOffset GetUtcNow() =>
            new DateTimeOffset(2026, 10, 3, 23, 58, 0, TimeSpan.Zero).AddDays(
                Interlocked.Increment(ref _reads) - 1
            );
    }

    private sealed class EmptySecrets : IFacetSecretStore
    {
        public string? Read(string identity) => null;

        public void Save(string identity, string value) =>
            throw new InvalidOperationException("This test does not authorize a remote account.");

        public void Remove(string identity) { }
    }

    private sealed class Dispatcher : IUiDispatcher
    {
        public bool HasThreadAccess => true;

        public void Enqueue(Action action) => action();
    }

    /// <summary>Framework cancellation and diagnostics.</summary>
    public TestContext TestContext { get; set; } = null!;
}
