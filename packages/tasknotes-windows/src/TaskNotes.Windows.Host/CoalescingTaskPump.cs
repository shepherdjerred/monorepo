using System.Threading.Channels;
using Microsoft.VisualStudio.Threading;

namespace TaskNotes.Windows.Host
{
    /// <summary>Owns and coalesces background work without detached tasks.</summary>
    internal sealed class CoalescingTaskPump : System.IAsyncDisposable
    {
        private readonly Channel<bool> _requests = Channel.CreateBounded<bool>(
            new BoundedChannelOptions(1)
            {
                SingleReader = true,
                SingleWriter = false,
                AllowSynchronousContinuations = false,
                FullMode = BoundedChannelFullMode.DropWrite,
            }
        );
        private readonly Func<Task> _operation;
        private readonly JoinableTaskContext _joinableTaskContext;
        private readonly JoinableTask _worker;
        private int _disposed;

        internal CoalescingTaskPump(Func<Task> operation)
        {
            _operation = operation ?? throw new ArgumentNullException(nameof(operation));
            _joinableTaskContext = new JoinableTaskContext();
            _worker = _joinableTaskContext.Factory.RunAsync(ProcessAsync);
        }

        internal void Request()
        {
            ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) == 1, this);
            if (_worker.IsCompleted)
            {
                throw new InvalidOperationException(
                    "The background work pump is no longer running."
                );
            }

            _ = _requests.Writer.TryWrite(true);
        }

        public async ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 1)
            {
                return;
            }

            _ = _requests.Writer.TryComplete();
            await _worker;
            _joinableTaskContext.Dispose();
        }

        private async Task ProcessAsync()
        {
            await foreach (bool _ in _requests.Reader.ReadAllAsync().ConfigureAwait(false))
            {
                await _operation().ConfigureAwait(false);
            }
        }
    }
}
