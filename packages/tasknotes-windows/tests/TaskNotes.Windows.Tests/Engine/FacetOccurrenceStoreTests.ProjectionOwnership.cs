using TaskNotes.Windows.Host;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Tests;

public sealed partial class FacetOccurrenceStoreTests
{
    /// <summary>A rejected vault query must never publish another vault's actionable rows, even when both contain identical paths and revisions.</summary>
    [TestMethod]
    public async Task BudgetRejectedVaultSwitchCannotReusePreviousVaultProjectionOrSubmitItsRows()
    {
        await using Fixture fixture = await Fixture.CreateAsync(ready: false);
        await fixture.AddSecondReadyProfileAsync(dense: true);
        byte[] first = await File.ReadAllBytesAsync(fixture.Plain);
        byte[] second = await File.ReadAllBytesAsync(fixture.SecondPlain);
        CollectionAssert.AreEqual(
            first,
            second,
            "The cross-vault regression deliberately requires indistinguishable path/content revisions."
        );
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null);
        TaskItem source = store.State.AllTasks.Single(task => task.Title == "Synthetic plain task");
        Assert.AreEqual("p", source.ProfileId);
        await store.SelectProfileAsync("q");
        Assert.AreEqual("q", store.SelectedProfileId);
        Exception? staleCompletion = null;
        try
        {
            await store.SetCompletionAsync(source.Id, true);
        }
        catch (ArgumentException error)
        {
            staleCompletion = error;
        }
        CollectionAssert.AreEqual(first, await File.ReadAllBytesAsync(fixture.Plain));
        CollectionAssert.AreEqual(
            second,
            await File.ReadAllBytesAsync(fixture.SecondPlain),
            "A stale A row must not change the byte-identical note in selected B."
        );
        Assert.IsNotNull(
            staleCompletion,
            "A stale source must reject before a new mutation is admitted."
        );
        Assert.IsEmpty(
            store.State.AllTasks,
            "A budget-rejected new profile has no completed task projection to retain."
        );
        Assert.IsEmpty(store.State.VisibleTasks);
        Assert.IsEmpty(store.State.TodayTasks);
        Assert.IsEmpty(store.State.SavedViews);
        Assert.Contains("repeat rule", store.State.UserFacingError!);
        foreach (
            Func<Task> submit in new Func<Task>[]
            {
                () => store.SetCompletionAsync(source.Id, true),
                () => store.SetStatusAsync(source.Id, "done"),
                () => store.DeleteTaskAsync(source.Id),
                () => store.CompleteTasksAsync([source.Id]),
                () => store.ScheduleTasksAsync([source.Id], "2026-11-01"),
                () => store.PrioritizeTasksAsync([source.Id], "high"),
                () => store.DeleteTasksAsync([source.Id]),
                () => store.SetRowCompletionAsync(source, true),
                () => store.SetRowStatusAsync(source, "done"),
                () => store.CompleteRowsAsync([source]),
                () => store.ScheduleRowsAsync([source], "2026-11-01"),
                () => store.PrioritizeRowsAsync([source], "high"),
                () => store.DeleteRowsAsync([source]),
            }
        )
            _ = await Assert.ThrowsExactlyAsync<ArgumentException>(submit);
        CollectionAssert.AreEqual(first, await File.ReadAllBytesAsync(fixture.Plain));
        CollectionAssert.AreEqual(second, await File.ReadAllBytesAsync(fixture.SecondPlain));
        Assert.IsEmpty(
            fixture.Pending(),
            "Rejecting stale projection ownership must happen before any new journal admission."
        );
        await store.SelectProfileAsync("p");
        Assert.AreEqual(
            "p",
            store.State.AllTasks.Single(task => task.Title == source.Title).ProfileId
        );
        await store.SetRowCompletionAsync(source, true);
        CollectionAssert.AreEqual(second, await File.ReadAllBytesAsync(fixture.SecondPlain));
        await store.UndoCompletionAsync();
        CollectionAssert.AreEqual(first, await File.ReadAllBytesAsync(fixture.Plain));
    }

    /// <summary>Cold budget failure has no task projection but still exposes the exact owning saved actions and real core Undo.</summary>
    [TestMethod]
    public async Task ColdBudgetFailureKeepsOwnedSavedActionsAndActualUndoWithoutBorrowingRows()
    {
        await using Fixture fixture = await Fixture.CreateAsync(ready: false);
        await fixture.AddSecondReadyProfileAsync(dense: true);
        byte[] first = await File.ReadAllBytesAsync(fixture.Plain);
        byte[] second = await File.ReadAllBytesAsync(fixture.SecondPlain);
        var pending = fixture.RetainSecondPlainUpdate();
        await fixture.CompleteSecondPlainOutsideHostAsync();
        fixture.SelectForColdStart("q");
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null);
        Assert.AreEqual("q", store.SelectedProfileId);
        Assert.IsEmpty(store.State.AllTasks);
        Assert.IsEmpty(store.State.VisibleTasks);
        Assert.IsEmpty(store.State.TodayTasks);
        Assert.IsEmpty(store.State.SavedViews);
        Assert.IsTrue(
            store.State.CanUndoCompletion,
            "Core user Undo must be published independently of a rejected task query."
        );
        var visible = store.State.FacetPendingActions.Single();
        Assert.AreEqual(pending.Id, visible.Id);
        Assert.AreEqual("q", visible.ProfileId);
        await store.UndoCompletionAsync();
        CollectionAssert.AreEqual(second, await File.ReadAllBytesAsync(fixture.SecondPlain));
        CollectionAssert.AreEqual(first, await File.ReadAllBytesAsync(fixture.Plain));
        Assert.AreEqual(
            pending.Document,
            fixture.Pending().Single().Document,
            "Publishing another profile must not replace a retained immutable admission."
        );
        await store.RetireRejectedMutationAsync(pending.Id);
        Assert.IsEmpty(store.State.FacetPendingActions);
        Assert.IsEmpty(store.State.AllTasks);
        _ = await Assert.ThrowsExactlyAsync<Core.FacetEngineException.Conflict>(() =>
            store.RemoveProfileAsync("q")
        );
        Assert.AreEqual(
            "q",
            store.SelectedProfileId,
            "Unsynchronized durable changes must continue blocking profile removal."
        );
        Assert.IsEmpty(store.State.AllTasks);
        CollectionAssert.AreEqual(first, await File.ReadAllBytesAsync(fixture.Plain));
    }

    /// <summary>Removing a query-rejected selected profile publishes only the surviving owner and clears the final removed projection.</summary>
    [TestMethod]
    public async Task RemovingBudgetRejectedProfileCannotReviveAnotherOwnersCache()
    {
        await using Fixture fixture = await Fixture.CreateAsync(ready: false);
        await fixture.AddSecondReadyProfileAsync(dense: true);
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null);
        TaskItem source = store.State.AllTasks.Single(task => task.Title == "Synthetic plain task");
        await store.SelectProfileAsync("q");
        Assert.IsEmpty(store.State.AllTasks);
        await store.RemoveProfileAsync("q");
        Assert.AreEqual("p", store.SelectedProfileId);
        Assert.IsTrue(store.State.AllTasks.All(task => task.ProfileId == "p"));
        await store.RemoveProfileAsync("p");
        Assert.IsNull(store.SelectedProfileId);
        Assert.IsEmpty(store.State.AllTasks);
        Assert.IsEmpty(store.State.VisibleTasks);
        Assert.IsEmpty(store.State.SavedViews);
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            store.SetRowCompletionAsync(source, true)
        );
        Assert.IsEmpty(fixture.Pending());
    }
}
