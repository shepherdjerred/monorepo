using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests
{
    /// <summary>Exercises coalescing background pump concurrency and shutdown invariants.</summary>
    [TestClass]
    public sealed class InfrastructureConcurrencyTests
    {
        /// <summary>Coalesces bursts, drains requested work, and rejects requests after shutdown.</summary>
        [TestMethod]
        public async Task BackgroundPumpCoalescesBurstsAndDrainsBeforeDisposal()
        {
            TaskCompletionSource started = new(TaskCreationOptions.RunContinuationsAsynchronously);
            TaskCompletionSource release = new(TaskCreationOptions.RunContinuationsAsynchronously);
            int invocations = 0;
            CoalescingTaskPump pump = new(async () =>
            {
                if (Interlocked.Increment(ref invocations) == 1)
                {
                    _ = started.TrySetResult();
                    await release.Task.WaitAsync(TestContext.CancellationToken);
                }
            });
            pump.Request();
            await started.Task.WaitAsync(TestContext.CancellationToken);
            for (int index = 0; index < 20; index++)
            {
                pump.Request();
            }
            _ = release.TrySetResult();
            await pump.DisposeAsync();

            Assert.AreEqual(2, invocations);
            _ = Assert.ThrowsExactly<ObjectDisposedException>(pump.Request);
            await pump.DisposeAsync();
        }

        /// <summary>Surfaces pump failures rather than silently accepting later requests.</summary>
        [TestMethod]
        public async Task BackgroundPumpPublishesOperationFailure()
        {
            TaskCompletionSource invoked = new(TaskCreationOptions.RunContinuationsAsynchronously);
            CoalescingTaskPump pump = new(() =>
            {
                _ = invoked.TrySetResult();
                throw new InvalidOperationException("pump failed");
            });
            pump.Request();
            await invoked.Task.WaitAsync(TestContext.CancellationToken);
            await Assert.ThrowsExactlyAsync<InvalidOperationException>(async () =>
                await pump.DisposeAsync()
            );
        }

        /// <summary>Gets or sets the MSTest execution context.</summary>
        public required TestContext TestContext { get; set; }
    }
}
