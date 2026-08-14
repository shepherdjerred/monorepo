using System.Globalization;
using System.Security.Cryptography;
using Microsoft.VisualStudio.Threading;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Host
{
    internal sealed class SystemClock : Core.Clock
    {
        public long NowMillis()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        public string LocalYmd(long millis)
        {
            return DateTimeOffset
                .FromUnixTimeMilliseconds(millis)
                .ToLocalTime()
                .ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }
    }

    internal sealed class CryptographicRandomness : Core.Randomness
    {
        public uint NextUnitPpm()
        {
            return (uint)RandomNumberGenerator.GetInt32(1_000_000);
        }
    }

    internal sealed class RetryTimerScheduler : Core.RetryScheduler, System.IAsyncDisposable
    {
        private readonly Lock _gate = new();
        private readonly Dictionary<ulong, TimerRegistration> _timers = [];
        private readonly JoinableTaskContext _joinableTaskContext = new();
        private Func<ValueTask>? _onTimer;
        private long _nextId;
        private bool _disposed;

        internal void Bind(Func<ValueTask> onTimer)
        {
            ArgumentNullException.ThrowIfNull(onTimer);
            lock (_gate)
            {
                ObjectDisposedException.ThrowIf(_disposed, this);
                if (_onTimer is not null)
                {
                    throw new InvalidOperationException("The retry scheduler is already bound.");
                }

                _onTimer = onTimer;
            }
        }

        public ulong Arm(long delayMillis)
        {
            ArgumentOutOfRangeException.ThrowIfNegative(delayMillis);
            lock (_gate)
            {
                ObjectDisposedException.ThrowIf(_disposed, this);
                Func<ValueTask> onTimer =
                    _onTimer
                    ?? throw new InvalidOperationException("The retry scheduler is not bound.");
                ulong id = checked((ulong)Interlocked.Increment(ref _nextId));
                CancellationTokenSource cancellation = new();
                AsyncManualResetEvent start = new();
                JoinableTask timerTask = _joinableTaskContext.Factory.RunAsync(async () =>
                {
                    await start.WaitAsync().ConfigureAwait(false);
                    await RunTimerAsync(
                            id,
                            TimeSpan.FromMilliseconds(delayMillis),
                            cancellation,
                            onTimer
                        )
                        .ConfigureAwait(false);
                });
                _timers.Add(id, new TimerRegistration(cancellation, timerTask));
                start.Set();

                return id;
            }
        }

        public void Cancel(ulong timer)
        {
            lock (_gate)
            {
                if (_timers.TryGetValue(timer, out TimerRegistration? registration))
                {
                    registration.Cancellation.Cancel();
                }
            }
        }

        public async ValueTask DisposeAsync()
        {
            TimerRegistration[] registrations;
            lock (_gate)
            {
                if (_disposed)
                {
                    return;
                }

                _disposed = true;
                registrations = [.. _timers.Values];
            }

            if (registrations.Length > 0)
            {
                foreach (TimerRegistration registration in registrations)
                {
                    await registration.Cancellation.CancelAsync().ConfigureAwait(false);
                }

                foreach (TimerRegistration registration in registrations)
                {
                    await registration.TimerTask;
                    registration.Cancellation.Dispose();
                }
            }

            _joinableTaskContext.Dispose();
        }

        private async Task RunTimerAsync(
            ulong id,
            TimeSpan delay,
            CancellationTokenSource cancellation,
            Func<ValueTask> onTimer
        )
        {
            try
            {
                await Task.Delay(delay, cancellation.Token).ConfigureAwait(false);
                await onTimer().ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
            {
                return;
            }
            finally
            {
                lock (_gate)
                {
                    if (_timers.Remove(id, out TimerRegistration? active))
                    {
                        if (!_disposed)
                        {
                            active.Cancellation.Dispose();
                        }
                    }
                }
            }
        }

        private sealed record TimerRegistration(
            CancellationTokenSource Cancellation,
            JoinableTask TimerTask
        );
    }
}
