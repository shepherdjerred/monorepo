namespace TaskNotes.Windows.Tests;

public sealed partial class FacetOccurrenceStoreTests
{
    /// <summary>A parent disappearing between a complete plan and native dispatch cannot fault the pump or starve another ready profile.</summary>
    [TestMethod]
    public async Task ParentRenameOrDeletionAfterAdmissionRetiresOnlyObservedRejectionAndKeepsOtherProfilesMoving()
    {
        foreach (string change in new[] { "renamed", "deleted" })
        {
            await using Fixture fixture = await Fixture.CreateAsync();
            await fixture.AddSecondReadyProfileAsync();
            fixture.AfterFirstAutomaticAdmission(() => fixture.ChangeParent(change));
            await using var store = fixture.Open();
            await store.InitializeAsync(null, null);
            await store.RefreshAsync();
            Assert.HasCount(change == "renamed" ? 3 : 0, fixture.Children());
            Assert.HasCount(3, fixture.SecondChildren());
            Assert.IsEmpty(fixture.Pending());
            Assert.IsEmpty(store.State.FacetPendingActions);
            Assert.IsFalse(store.State.CanUndoCompletion);
        }
    }
}
