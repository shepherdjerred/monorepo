using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

public sealed partial class FacetStoreTests
{
    private static readonly string[] PreparedExactProjects = ["ACME, Inc"];

    /// <summary>Submission uses the reviewed core date and copied fields even after local midnight.</summary>
    [TestMethod]
    public async Task PreparedCapturePreservesDatesAndTokensAcrossMidnight()
    {
        using Fixture fixture = new();
        var time = new PreparedCaptureClock();
        await using var store = fixture.Open(time);
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        string[] projects = ["ACME, Inc"];
        var prepared = await store.PrepareCaptureAsync(
            "Review tomorrow",
            TaskListQuery.Today,
            "p",
            new FacetCaptureOptions(Body: new("Reviewed body"), Projects: new(projects)),
            TestContext.CancellationToken
        );
        Assert.AreEqual("Review", prepared.Preview.Title);
        Assert.AreEqual("2026-10-10", prepared.Preview.Due);
        Assert.AreEqual("2026-10-09", prepared.Preview.Scheduled);
        projects[0] = "Changed after preview";
        time.Instant = new DateTimeOffset(2026, 10, 10, 0, 1, 0, TimeSpan.Zero);
        string? admitted = null;
        await store.SubmitPreparedCaptureAsync(
            prepared,
            id => admitted = id,
            TestContext.CancellationToken
        );
        Assert.IsNotNull(admitted);
        var task = store.State.AllTasks.Single();
        Assert.AreEqual(prepared.Preview.Title, task.Title);
        Assert.AreEqual(prepared.Preview.Due, task.Due);
        Assert.AreEqual(prepared.Preview.Scheduled, task.Scheduled);
        CollectionAssert.AreEqual(PreparedExactProjects, task.Projects.ToArray());
        Assert.IsNotNull(task.VaultPath);
        Assert.Contains(
            "Reviewed body",
            await File.ReadAllTextAsync(
                Path.Combine(fixture.Root, task.VaultPath),
                TestContext.CancellationToken
            )
        );
        Assert.IsEmpty(new FacetMutationJournal(fixture.StatePath).PendingEntries);
    }

    /// <summary>Switching away and back cannot retarget an old prepared capture or admit a new action.</summary>
    [TestMethod]
    public async Task PreparedCaptureRejectsChangedProfileGenerationBeforeAdmission()
    {
        using Fixture fixture = new();
        fixture.AddSecondProfile();
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        var prepared = await store.PrepareCaptureAsync(
            "Original vault task",
            TaskListQuery.Today,
            "p",
            new FacetCaptureOptions(),
            TestContext.CancellationToken
        );
        bool admitted = false;
        await store.SelectProfileAsync("q", TestContext.CancellationToken);
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            store.SubmitPreparedCaptureAsync(
                prepared,
                _ => admitted = true,
                TestContext.CancellationToken
            )
        );
        await store.SelectProfileAsync("p", TestContext.CancellationToken);
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            store.SubmitPreparedCaptureAsync(
                prepared,
                _ => admitted = true,
                TestContext.CancellationToken
            )
        );
        Assert.IsFalse(admitted);
        Assert.IsEmpty(new FacetMutationJournal(fixture.StatePath).PendingEntries);
        Assert.IsEmpty(store.State.AllTasks);
    }

    /// <summary>A replacement engine for the same profile cannot accept the previous engine's payload.</summary>
    [TestMethod]
    public async Task PreparedCaptureRejectsReplacementSessionBeforeAdmission()
    {
        using Fixture fixture = new();
        FacetPreparedCapture prepared;
        await using (var original = fixture.Open())
        {
            await original.InitializeAsync(null, null, TestContext.CancellationToken);
            prepared = await original.PrepareCaptureAsync(
                "Previous session task",
                TaskListQuery.Today,
                "p",
                new FacetCaptureOptions(),
                TestContext.CancellationToken
            );
        }
        await using var replacement = fixture.Open();
        await replacement.InitializeAsync(null, null, TestContext.CancellationToken);
        bool admitted = false;
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            replacement.SubmitPreparedCaptureAsync(
                prepared,
                _ => admitted = true,
                TestContext.CancellationToken
            )
        );
        Assert.IsFalse(admitted);
        Assert.IsEmpty(new FacetMutationJournal(fixture.StatePath).PendingEntries);
        Assert.IsEmpty(replacement.State.AllTasks);
    }

    /// <summary>An applied but unobserved submission retains one action and cannot be recreated after recovery.</summary>
    [TestMethod]
    public async Task PreparedCaptureCannotReadmitItsActionBeforeOrAfterRecovery()
    {
        using Fixture fixture = new();
        var time = new ObservationFaultTime();
        await using var store = fixture.Open(time);
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        var prepared = await store.PrepareCaptureAsync(
            "Exactly one task",
            TaskListQuery.Today,
            "p",
            new FacetCaptureOptions(),
            TestContext.CancellationToken
        );
        List<string> admissions = [];
        List<FacetAppliedFeedback> outcomes = [];
        store.AppliedFeedback += outcome =>
        {
            outcomes.Add(outcome);
            time.FailNextRead = true;
        };
        _ = await Assert.ThrowsExactlyAsync<FacetSavedObservationException>(() =>
            store.SubmitPreparedCaptureAsync(
                prepared,
                admissions.Add,
                TestContext.CancellationToken
            )
        );
        Assert.HasCount(1, admissions);
        Assert.HasCount(1, outcomes);
        string action = admissions.Single();
        Assert.AreEqual(action, outcomes.Single().Owner.MutationId);
        Assert.AreEqual(
            action,
            new FacetMutationJournal(fixture.StatePath).PendingEntries.Single().Id
        );
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            store.SubmitPreparedCaptureAsync(
                prepared,
                admissions.Add,
                TestContext.CancellationToken
            )
        );
        Assert.HasCount(1, admissions);
        Assert.AreEqual(
            action,
            new FacetMutationJournal(fixture.StatePath).PendingEntries.Single().Id
        );
        var reprepared = await store.PrepareCaptureAsync(
            "Exactly one task",
            TaskListQuery.Today,
            "p",
            new FacetCaptureOptions(),
            TestContext.CancellationToken
        );
        string? existingAction = null;
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            store.SubmitPreparedCaptureAsync(
                reprepared,
                id => existingAction = id,
                TestContext.CancellationToken
            )
        );
        Assert.AreEqual(action, existingAction);
        Assert.HasCount(1, outcomes);
        Assert.AreEqual(
            action,
            new FacetMutationJournal(fixture.StatePath).PendingEntries.Single().Id
        );
        await store.ResumeMutationAsync(action, TestContext.CancellationToken);
        Assert.IsEmpty(new FacetMutationJournal(fixture.StatePath).PendingEntries);
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            store.SubmitPreparedCaptureAsync(
                prepared,
                admissions.Add,
                TestContext.CancellationToken
            )
        );
        Assert.HasCount(1, admissions);
        Assert.HasCount(1, outcomes);
        Assert.IsEmpty(new FacetMutationJournal(fixture.StatePath).PendingEntries);
        Assert.AreEqual("Exactly one task", store.State.AllTasks.Single().Title);
    }

    private sealed class PreparedCaptureClock : TimeProvider
    {
        internal DateTimeOffset Instant { get; set; } = new(2026, 10, 9, 23, 59, 0, TimeSpan.Zero);

        public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;

        public override DateTimeOffset GetUtcNow() => Instant;
    }
}
