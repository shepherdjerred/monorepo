using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests
{
    /// <summary>Verifies clock, randomness, scheduler, and runner callback behavior.</summary>
    [TestClass]
    public sealed class SystemCallbackTests
    {
        /// <summary>Checks host clock formatting and random-number range.</summary>
        [TestMethod]
        public void ClockAndRandomnessSatisfyCoreContracts()
        {
            SystemClock clock = new();
            CryptographicRandomness randomness = new();

            Assert.IsGreaterThan(0, clock.NowMillis());
            Assert.MatchesRegex("^[0-9]{4}-[0-9]{2}-[0-9]{2}$", clock.LocalYmd(clock.NowMillis()));
            Assert.IsLessThan(1_000_000u, randomness.NextUnitPpm());
        }

        /// <summary>Checks timer delivery and repeated cancellation.</summary>
        [TestMethod]
        public async Task RetryCancellationIsIdempotent()
        {
            await using RetryTimerScheduler scheduler = new();
            TaskCompletionSource fired = new(TaskCreationOptions.RunContinuationsAsynchronously);
            scheduler.Bind(() =>
            {
                _ = fired.TrySetResult();
                return ValueTask.CompletedTask;
            });

            ulong cancelled = scheduler.Arm(50);
            scheduler.Cancel(cancelled);
            scheduler.Cancel(cancelled);
            ulong live = scheduler.Arm(1);

            await fired.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.CancellationToken);
            scheduler.Cancel(live);
        }

        /// <summary>Proves concurrent callers execute one at a time and in queue order.</summary>
        [TestMethod]
        public async Task EngineRunnerSerializesConcurrentCallers()
        {
            await using EngineRunner runner = new();
            int active = 0;
            int maximum = 0;
            Task<int>[] work =
            [
                .. Enumerable
                    .Range(0, 12)
                    .Select(index =>
                        runner.RunAsync(
                            () =>
                            {
                                int current = Interlocked.Increment(ref active);
                                InterlockedExtensions.Max(ref maximum, current);
                                Thread.Sleep(5);
                                _ = Interlocked.Decrement(ref active);
                                return index;
                            },
                            TestContext.CancellationToken
                        )
                    ),
            ];

            int[] results = await Task.WhenAll(work);

            Assert.AreEqual(1, maximum);
            Assert.AreSequenceEqual([.. Enumerable.Range(0, 12)], results);
        }

        /// <summary>Gets or sets the MSTest execution context.</summary>
        public required TestContext TestContext { get; set; }
    }
}
