using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests
{
    /// <summary>Exercises ownership, ordering, cancellation, and shutdown of host infrastructure.</summary>
    [TestClass]
    public sealed class InfrastructureConcurrencyTests
    {
        /// <summary>Serializes concurrent requests in FIFO order and isolates a failed operation.</summary>
        [TestMethod]
        public async Task EngineRunnerOrdersConcurrentWorkAndIsolatesExceptions()
        {
            await using EngineRunner runner = new();
            TaskCompletionSource firstStarted = new(
                TaskCreationOptions.RunContinuationsAsynchronously
            );
            TaskCompletionSource releaseFirst = new(
                TaskCreationOptions.RunContinuationsAsynchronously
            );
            List<int> order = [];
            Task<int> first = runner.RunAsync(
                () =>
                {
                    order.Add(1);
                    _ = firstStarted.TrySetResult();
                    releaseFirst.Task.GetAwaiter().GetResult();
                    return 1;
                },
                TestContext.CancellationToken
            );
            await firstStarted.Task.WaitAsync(TestContext.CancellationToken);
            Task<int> failed = runner.RunAsync<int>(() =>
                throw new InvalidOperationException("expected")
            );
            Task<int> third = runner.RunAsync(() =>
            {
                order.Add(3);
                return 3;
            });

            _ = releaseFirst.TrySetResult();

            Assert.AreEqual(1, await first);
            InvalidOperationException exception =
                await Assert.ThrowsExactlyAsync<InvalidOperationException>(async () =>
                    await failed.WaitAsync(TestContext.CancellationToken)
                );
            Assert.AreEqual("expected", exception.Message);
            Assert.AreEqual(3, await third);
            Assert.AreSequenceEqual([1, 3], order);
        }

        /// <summary>Honors cancellation for queued work and rejects work after an idempotent shutdown.</summary>
        [TestMethod]
        public async Task EngineRunnerCancelsQueuedWorkAndRejectsPostDisposalCalls()
        {
            EngineRunner runner = new();
            TaskCompletionSource started = new(TaskCreationOptions.RunContinuationsAsynchronously);
            TaskCompletionSource release = new(TaskCreationOptions.RunContinuationsAsynchronously);
            Task<int> blocking = runner.RunAsync(() =>
            {
                _ = started.TrySetResult();
                release.Task.GetAwaiter().GetResult();
                return 1;
            });
            await started.Task.WaitAsync(TestContext.CancellationToken);
            using CancellationTokenSource cancellation = new();
            Task<int> cancelled = runner.RunAsync(() => 2, cancellation.Token);
            await cancellation.CancelAsync();
            _ = release.TrySetResult();

            Assert.AreEqual(1, await blocking);
            _ = await Assert.ThrowsExactlyAsync<OperationCanceledException>(async () =>
                await cancelled.WaitAsync(TestContext.CancellationToken)
            );
            await runner.DisposeAsync();
            await runner.DisposeAsync();
            _ = await Assert.ThrowsExactlyAsync<ObjectDisposedException>(async () =>
                await runner.RunAsync(() => 3)
            );
        }

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

        /// <summary>Runs and cancels retry timers once while validating lifecycle contracts.</summary>
        [TestMethod]
        public async Task RetrySchedulerIsBoundedIdempotentAndDisposable()
        {
            RetryTimerScheduler scheduler = new();
            _ = Assert.ThrowsExactly<InvalidOperationException>(() => scheduler.Arm(0));
            _ = Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => scheduler.Arm(-1));
            TaskCompletionSource fired = new(TaskCreationOptions.RunContinuationsAsynchronously);
            scheduler.Bind(() =>
            {
                _ = fired.TrySetResult();
                return ValueTask.CompletedTask;
            });
            _ = Assert.ThrowsExactly<InvalidOperationException>(() =>
                scheduler.Bind(() => ValueTask.CompletedTask)
            );
            _ = scheduler.Arm(0);
            await fired.Task.WaitAsync(TestContext.CancellationToken);
            ulong cancelled = scheduler.Arm(60_000);
            scheduler.Cancel(cancelled);
            scheduler.Cancel(cancelled);
            await scheduler.DisposeAsync();
            await scheduler.DisposeAsync();
            _ = Assert.ThrowsExactly<ObjectDisposedException>(() => scheduler.Arm(0));
        }

        /// <summary>Returns bounded cryptographic values and stable local civil-date formatting.</summary>
        [TestMethod]
        public void SystemCallbacksRespectTheirCoreContracts()
        {
            SystemClock clock = new();
            long before = DateTimeOffset.UtcNow.AddSeconds(-1).ToUnixTimeMilliseconds();
            long now = clock.NowMillis();
            long after = DateTimeOffset.UtcNow.AddSeconds(1).ToUnixTimeMilliseconds();
            Assert.IsTrue(now >= before && now <= after);
            Assert.MatchesRegex("^\\d{4}-\\d{2}-\\d{2}$", clock.LocalYmd(now));

            CryptographicRandomness randomness = new();
            for (int index = 0; index < 100; index++)
            {
                Assert.IsLessThan(1_000_000u, randomness.NextUnitPpm());
            }
        }

        /// <summary>Gets or sets the MSTest execution context.</summary>
        public required TestContext TestContext { get; set; }
    }
}
