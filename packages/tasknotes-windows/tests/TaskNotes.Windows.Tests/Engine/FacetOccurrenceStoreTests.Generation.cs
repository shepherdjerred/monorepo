namespace TaskNotes.Windows.Tests;

public sealed partial class FacetOccurrenceStoreTests
{
    /// <summary>Explicit window generation uses the user origin and retains real core Undo authority without any initial Sync shortcut.</summary>
    [TestMethod]
    public async Task ExplicitWindowGenerationAndUndoAreIndependentOfAutomaticReadiness()
    {
        await using Fixture fixture = await Fixture.CreateAsync(ready: false);
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null);
        var parent = store.State.AllTasks.Single(task => task.Title == "Synthetic rolling series");
        await store.GenerateOccurrenceWindowAsync(parent);
        Assert.HasCount(3, fixture.Children());
        Assert.IsTrue(store.State.CanUndoCompletion);
        await store.RefreshAsync();
        Assert.IsTrue(store.State.CanUndoCompletion);
        await store.UndoCompletionAsync();
        Assert.IsEmpty(fixture.Children());
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            store.GenerateOccurrenceAsync(parent with { ProfileId = null }, "2026-10-24")
        );
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            store.GenerateOccurrenceWindowAsync(parent with { ProfileId = null })
        );
    }

    /// <summary>Completion remains durable after future expansion fails; a cold restart discovers typed repair without its cleaned primary draft.</summary>
    [TestMethod]
    public async Task DeferredCompletionSurvivesRestartAndRepairsWithCurrentInput()
    {
        await using Fixture fixture = await Fixture.CreateAsync(ready: false);
        fixture.EditParent(
            "occurrence_materialization: rolling",
            "occurrence_materialization: on_completion"
        );
        await fixture.AddSecondReadyProfileAsync();
        string child;
        string primary;
        string successor;
        await using (var initial = fixture.Open())
        {
            await initial.InitializeAsync(null, null);
            var parent = initial.State.AllTasks.Single(task =>
                task.Title == "Synthetic rolling series"
            );
            await initial.GenerateOccurrenceAsync(parent, "2026-10-24");
            child = fixture.Children().Single();
            string repeated = string.Join(',', Enumerable.Repeat("0", 101));
            fixture.EditParent(
                "DTSTART:20261024;FREQ=DAILY",
                $"DTSTART:20261024;FREQ=DAILY;COUNT=1;BYHOUR={repeated};BYMINUTE={repeated};BYSECOND={repeated}"
            );
            await initial.RefreshAsync();
            var row = initial.State.AllTasks.Single(task =>
                task.VaultPath
                == Path.GetRelativePath(Path.GetDirectoryName(fixture.Plain)!, child)
                    .Replace('\\', '/')
            );
            await initial.SetCompletionAsync(row.Id, true);
            Assert.AreEqual(
                "done",
                (await fixture.ChildPropertiesAsync(child))
                    .GetProperty("frontmatter")
                    .GetProperty("status")
                    .GetString()
            );
            var failure = initial.State.FacetGenerationFailures.Single();
            Assert.AreEqual("deferred_progression", failure.Kind);
            Assert.IsTrue(failure.CanRepair);
            Assert.IsEmpty(
                initial.State.FacetPendingActions,
                "The applied primary draft must be cleaned up independently of durable future failure discovery."
            );
            Assert.IsTrue(
                initial.State.AllTasks.Any(task =>
                    task.Title == "Synthetic plain task" && task.ProfileId == "p"
                ),
                "A same-profile budget rejection retains only its own last complete projection."
            );
            Assert.IsTrue(initial.State.CanUndoCompletion);
            primary = failure.PrimaryMutationId;
            successor = failure.SuccessorId;
            var outcomes = await fixture.ReadFeatureAsync(
                new { kind = "occurrence_successors", mutationId = primary }
            );
            Assert.AreEqual(
                successor,
                outcomes.GetProperty("items")[0].GetProperty("successorId").GetString()
            );
            var progress = await fixture.ReadFeatureAsync(new { kind = "sync_status" });
            Assert.IsFalse(
                progress.GetProperty("initialSyncComplete").GetBoolean(),
                "Explicit generation never manufactures initial Sync readiness."
            );
            await initial.SelectProfileAsync("q");
            Assert.IsTrue(initial.State.AllTasks.All(task => task.ProfileId == "q"));
            await initial.SelectProfileAsync("p");
            Assert.IsEmpty(
                initial.State.AllTasks,
                "Switching back to a budget-rejected profile must not borrow the other profile's completed projection."
            );
            Assert.IsTrue(initial.State.CanUndoCompletion);
            Assert.AreEqual(
                primary,
                initial.State.FacetGenerationFailures.Single().PrimaryMutationId
            );
        }
        await using var reopened = fixture.Open();
        await reopened.InitializeAsync(null, null);
        Assert.IsEmpty(
            reopened.State.AllTasks,
            "A cold budget failure has no previous projection to retain."
        );
        Assert.IsTrue(reopened.State.CanUndoCompletion);
        Assert.IsTrue(
            reopened.State.FacetGenerationFailures.Any(row =>
                row.PrimaryMutationId == primary && row.SuccessorId == successor
            )
        );
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            reopened.RepairGenerationAsync("another", primary, successor)
        );
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            reopened.RepairGenerationAsync("p", primary, "not-the-original-outcome")
        );
        byte[] parentBeforeRemoval = fixture.ReadParent();
        fixture.ChangeParent("deleted");
        await reopened.RefreshAsync();
        Assert.IsFalse(
            reopened
                .State.FacetGenerationFailures.Single(row => row.SuccessorId == successor)
                .CanRepair
        );
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            reopened.RepairGenerationAsync("p", primary, successor)
        );
        Assert.IsEmpty(
            reopened.State.FacetPendingActions,
            "Unrepairable current input cannot admit a new guessed command."
        );
        fixture.RestoreParent(parentBeforeRemoval);
        string excessive = string.Join(',', Enumerable.Repeat("0", 101));
        fixture.EditParent(
            $"DTSTART:20261024;FREQ=DAILY;COUNT=1;BYHOUR={excessive};BYMINUTE={excessive};BYSECOND={excessive}",
            "DTSTART:20261024;FREQ=DAILY"
        );
        await reopened.RefreshAsync();
        await reopened.RepairGenerationAsync("p", primary, successor);
        Assert.HasCount(2, fixture.Children());
        Assert.AreEqual(
            "done",
            (await fixture.ChildPropertiesAsync(child))
                .GetProperty("frontmatter")
                .GetProperty("status")
                .GetString()
        );
        Assert.IsFalse(
            reopened.State.FacetGenerationFailures.Any(row =>
                row.SuccessorId == successor && row.CanRepair
            )
        );
        Assert.IsEmpty(reopened.State.FacetPendingActions);
    }
}
