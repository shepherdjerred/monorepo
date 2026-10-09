using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.Tests;

public sealed partial class FacetStoreTests
{
    /// <summary>Metadata-only input is rejected using the core title, before creating any durable action.</summary>
    [TestMethod]
    public async Task MetadataOnlyCaptureRemainsEditableWithoutAdmittedJournal()
    {
        using Fixture fixture = new();
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        var capture = new QuickAddViewModel(store) { Input = "tomorrow p:Work" };
        Assert.IsFalse(await capture.SaveAsync(false, TestContext.CancellationToken));
        Assert.AreEqual("Add a task title.", capture.ValidationError);
        Assert.IsNull(capture.RecoveryActionId);
        Assert.IsEmpty(new FacetMutationJournal(fixture.StatePath).PendingEntries);
        capture.Input = "Prepare release tomorrow p:Work";
        Assert.IsTrue(await capture.SaveAsync(false, TestContext.CancellationToken));
        Assert.HasCount(1, store.State.AllTasks);
    }

    /// <summary>Applied local feedback precedes fallible observation; recovery is silent and cannot replay it.</summary>
    [TestMethod]
    public async Task AppliedFeedbackPrecedesFailedObservationAndRecoveryIsSilent()
    {
        using Fixture fixture = new();
        var time = new ObservationFaultTime();
        await using var store = fixture.Open(time);
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        var scene = new FacetFeedbackScene();
        scene.SetForeground(true);
        store.FeedbackScene = scene;
        List<FacetAppliedFeedback> events = [];
        store.AppliedFeedback += outcome =>
        {
            events.Add(outcome);
            Assert.IsTrue(store.OwnsFeedback(outcome));
            time.FailNextRead = true;
        };
        await store.AddAsync("Applied outcome", TaskListQuery.Today, TestContext.CancellationToken);
        Assert.HasCount(1, events);
        Assert.AreEqual("created", events[0].Event);
        Assert.IsTrue(events[0].Changed);
        Assert.HasCount(1, events[0].Paths!);
        Assert.HasCount(1, new FacetMutationJournal(fixture.StatePath).PendingEntries);
        await store.ResumeMutationAsync(events[0].Owner.MutationId, TestContext.CancellationToken);
        Assert.HasCount(1, events);
        Assert.HasCount(1, store.State.AllTasks);
    }

    /// <summary>Queued reads and independently admitted actions cannot invalidate another local outcome.</summary>
    [TestMethod]
    public async Task FeedbackSurvivesReadsAndNewActionsQueuedBeforeItsReceipt()
    {
        using Fixture fixture = new();
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        var scene = new FacetFeedbackScene();
        scene.SetForeground(true);
        store.FeedbackScene = scene;
        var accepted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var release = new ManualResetEventSlim();
        bool held = false;
        store.StateChanged += (_, _) =>
        {
            if (!held && store.State.FacetPendingActions.Count > 0)
            {
                held = true;
                accepted.SetResult();
                release.Wait(CancellationToken.None);
            }
        };
        List<FacetAppliedFeedback> events = [];
        store.AppliedFeedback += outcome =>
        {
            Assert.IsTrue(store.OwnsFeedback(outcome));
            events.Add(outcome);
        };
        Task first = Task.Run(
            () => store.AddAsync("First", TaskListQuery.Today, TestContext.CancellationToken),
            TestContext.CancellationToken
        );
        try
        {
            await accepted.Task.WaitAsync(TestContext.CancellationToken);
            Task preview = store.PreviewQuickAddAsync("Read", TestContext.CancellationToken);
            Task next = store.AddAsync(
                "Second",
                TaskListQuery.Today,
                TestContext.CancellationToken
            );
            release.Set();
            await Task.WhenAll(first, preview, next).WaitAsync(TestContext.CancellationToken);
        }
        finally
        {
            release.Set();
        }
        Assert.HasCount(2, events);
        Assert.IsTrue(store.OwnsFeedback(events[0]));
        Assert.AreNotEqual(events[0].Owner.MutationId, events[1].Owner.MutationId);
    }

    /// <summary>Exact current Undo rejects an obsolete reviewed receipt without adding a new journal action.</summary>
    [TestMethod]
    public async Task FeedbackUndoRequiresExactCurrentAuthoritativeReceipt()
    {
        using Fixture fixture = new();
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        List<FacetAppliedFeedback> events = [];
        store.AppliedFeedback += events.Add;
        await store.AddAsync("First", TaskListQuery.Today, TestContext.CancellationToken);
        string first = events.Single().Owner.MutationId;
        await store.AddAsync("Second", TaskListQuery.Today, TestContext.CancellationToken);
        string second = events.Last().Owner.MutationId;
        await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            store.UndoCurrentSavedAsync(first, TestContext.CancellationToken)
        );
        Assert.IsEmpty(new FacetMutationJournal(fixture.StatePath).PendingEntries);
        await store.UndoCurrentSavedAsync(second, TestContext.CancellationToken);
        Assert.AreEqual("undone", events.Last().Event);
        Assert.AreEqual("First", store.State.AllTasks.Single().Title);
    }

    /// <summary>Rich capture applies exact tokens and canonical explicit clears, not display punctuation.</summary>
    [TestMethod]
    public async Task DetailedCapturePreservesExactTokensAndExplicitClears()
    {
        using Fixture fixture = new();
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        string[] projects = ["ACME, Inc", "Engineering"];
        var options = new FacetCaptureOptions(
            Body: new(""),
            Due: new(null),
            Projects: new(projects),
            Contexts: new(Array.Empty<string>()),
            Tags: new(Array.Empty<string>()),
            Scheduled: new(null),
            Recurrence: new(null)
        );
        var preview = await store.PreviewCaptureAsync(
            "Exact #parsed @desk tomorrow",
            TaskListQuery.Today,
            "p",
            options,
            TestContext.CancellationToken
        );
        Assert.IsNull(preview.Due);
        Assert.IsNull(preview.Scheduled);
        Assert.IsNull(preview.Recurrence);
        CollectionAssert.AreEqual(projects, preview.Projects.ToArray());
        Assert.IsEmpty(preview.Contexts);
        Assert.IsEmpty(preview.Tags);
        await store.AddDetailedCaptureAsync(
            "Exact #parsed @desk tomorrow",
            TaskListQuery.Today,
            "p",
            options,
            _ => { },
            TestContext.CancellationToken
        );
        var task = store.State.AllTasks.Single();
        CollectionAssert.AreEqual(projects, task.Projects.ToArray());
        Assert.IsNull(task.Due);
        Assert.IsNull(task.Scheduled);
        Assert.IsNull(task.Recurrence);
        Assert.IsEmpty(task.Contexts);
        Assert.AreEqual("", task.Details);
    }
}
