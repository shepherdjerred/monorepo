using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>Actual OS ownership remains exclusive through cancellation and asynchronous writer cleanup.</summary>
[TestClass]
public sealed class FacetWriterLeaseTests
{
    /// <summary>The successor cannot open an engine before the prior writer explicitly releases its lease.</summary>
    [TestMethod]
    public async Task WriterTakeoverWaitsForDrainAndUsesTheSameDirectoryIdentity()
    {
        using TemporaryDirectory directory = new();
        var first = await FacetWriterLease.AcquireAsync(
            directory.Path,
            TestContext.CancellationToken
        );
        var waiting = FacetWriterLease.AcquireAsync(
            Path.Combine(directory.Path, "."),
            TestContext.CancellationToken
        );
        Assert.IsFalse(waiting.IsCompleted);
        await first.DisposeAsync();
        await using var successor = await waiting;
        await first.DisposeAsync();
        Assert.IsFalse(TestContext.CancellationToken.IsCancellationRequested);
    }

    /// <summary>A cancelled waiter cannot release the active writer or prevent a later valid takeover.</summary>
    [TestMethod]
    public async Task CancelledWaiterRetainsOriginalOwnershipAndIndependentVaultCanProceed()
    {
        using TemporaryDirectory directory = new();
        var first = await FacetWriterLease.AcquireAsync(
            directory.Path,
            TestContext.CancellationToken
        );
        using CancellationTokenSource cancelled = new();
        var waiting = FacetWriterLease.AcquireAsync(directory.Path, cancelled.Token);
        await cancelled.CancelAsync();
        _ = await Assert.ThrowsExactlyAsync<OperationCanceledException>(async () =>
            await waiting.WaitAsync(TestContext.CancellationToken)
        );
        await using var independent = await FacetWriterLease.AcquireAsync(
            Path.Combine(directory.Path, "other"),
            TestContext.CancellationToken
        );
        var successor = FacetWriterLease.AcquireAsync(
            directory.Path,
            TestContext.CancellationToken
        );
        Assert.IsFalse(successor.IsCompleted);
        await first.DisposeAsync();
        await using var observed = await successor;
    }

    /// <summary>Framework cancellation.</summary>
    public TestContext TestContext { get; set; } = null!;
}
