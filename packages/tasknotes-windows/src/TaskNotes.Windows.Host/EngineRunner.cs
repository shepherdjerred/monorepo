using System.Runtime.ExceptionServices;
using System.Threading.Channels;
using Microsoft.VisualStudio.Threading;

namespace TaskNotes.Windows.Host
{
    internal sealed class EngineRunner : System.IAsyncDisposable
    {
        private const int QueueCapacity = 128;

        private readonly Channel<WorkItem> _queue = Channel.CreateBounded<WorkItem>(
            new BoundedChannelOptions(QueueCapacity)
            {
                SingleReader = true,
                SingleWriter = false,
                AllowSynchronousContinuations = false,
                FullMode = BoundedChannelFullMode.Wait,
            }
        );
        private readonly JoinableTaskContext _joinableTaskContext;
        private readonly JoinableTask _worker;
        private int _disposed;

        internal EngineRunner()
        {
            _joinableTaskContext = new JoinableTaskContext();
            _worker = _joinableTaskContext.Factory.RunAsync(ProcessAsync);
        }

        internal async Task<T> RunAsync<T>(
            Func<T> operation,
            CancellationToken cancellationToken = default
        )
        {
            ArgumentNullException.ThrowIfNull(operation);
            ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) == 1, this);

            WorkItem<T> item = new(operation, cancellationToken);
            try
            {
                await _queue.Writer.WriteAsync(item, cancellationToken).ConfigureAwait(false);
            }
            catch (ChannelClosedException exception)
            {
                throw new ObjectDisposedException(nameof(EngineRunner), exception);
            }

            await item.Completion.WaitAsync(CancellationToken.None).ConfigureAwait(false);
            return item.GetResult();
        }

        public async ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 1)
            {
                return;
            }

            _ = _queue.Writer.TryComplete();
            await _worker;
            _joinableTaskContext.Dispose();
        }

        private async Task ProcessAsync()
        {
            await foreach (WorkItem item in _queue.Reader.ReadAllAsync().ConfigureAwait(false))
            {
                item.Execute();
            }
        }

        private abstract class WorkItem
        {
            internal abstract void Execute();
        }

        private sealed class WorkItem<T>(Func<T> operation, CancellationToken cancellationToken)
            : WorkItem
        {
            private ExceptionDispatchInfo? _failure;
            private ResultBox<T>? _result;

            internal AsyncManualResetEvent Completion { get; } = new();

            internal T GetResult()
            {
                _failure?.Throw();
                return (
                    _result
                    ?? throw new InvalidOperationException(
                        "Engine work completed without a result."
                    )
                ).Value;
            }

            internal override void Execute()
            {
                if (cancellationToken.IsCancellationRequested)
                {
                    _failure = ExceptionDispatchInfo.Capture(
                        new OperationCanceledException(cancellationToken)
                    );
                }
                else
                {
                    try
                    {
                        _result = new ResultBox<T>(operation());
                    }
                    catch (Exception exception)
                    {
                        _failure = ExceptionDispatchInfo.Capture(exception);
                    }
                }

                Completion.Set();
            }

            private sealed record ResultBox<TValue>(TValue Value);
        }
    }
}
