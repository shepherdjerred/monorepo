namespace TaskNotes.Windows.Tests;

public sealed partial class FacetOccurrenceStoreTests
{
    /// <summary>Secure authority disappearing after durable host admission prevents the native write and retains the original draft in Settings state.</summary>
    [TestMethod]
    public async Task AuthorityLossAfterAdmissionStopsWritesAndPublishesTheOriginalEnvelope()
    {
        await using Fixture fixture = await Fixture.CreateAsync();
        fixture.RemoveAuthorityWhen(() => fixture.Pending().Count != 0);
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null);
        Assert.IsEmpty(fixture.Children());
        var retained = fixture.Pending().Single();
        Assert.AreEqual(retained.Id, store.State.FacetPendingActions.Single().Id);
        var observed = await fixture.ReadFeatureAsync(
            new { kind = "mutation_receipt", mutationId = retained.Id }
        );
        Assert.AreEqual("absent", observed.GetProperty("state").GetString());
        await store.RefreshAsync();
        Assert.AreEqual(retained, fixture.Pending().Single());
        Assert.IsEmpty(fixture.Children());
    }

    /// <summary>Authority loss after an applied first window stops subsequent series writes and preserves its receipt-backed admission for observation.</summary>
    [TestMethod]
    public async Task AuthorityLossAfterFirstAppliedWindowRetainsItsEnvelopeAndStopsTheNextSeries()
    {
        await using Fixture fixture = await Fixture.CreateAsync();
        fixture.AddSecondSeries();
        fixture.RemoveAuthorityWhen(() => fixture.Children().Length >= 3);
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null);
        Assert.HasCount(3, fixture.Children());
        var retained = fixture.Pending().Single();
        Assert.AreEqual(retained.Id, store.State.FacetPendingActions.Single().Id);
        var observed = await fixture.ReadFeatureAsync(
            new { kind = "mutation_receipt", mutationId = retained.Id }
        );
        Assert.AreEqual("applied", observed.GetProperty("state").GetString());
        Assert.IsTrue(observed.GetProperty("receipt").GetProperty("applied").GetBoolean());
        await store.RefreshAsync();
        Assert.HasCount(3, fixture.Children());
        Assert.AreEqual(retained, fixture.Pending().Single());
    }
}
