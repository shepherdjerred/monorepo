using System.Runtime.ExceptionServices;
using Microsoft.Extensions.Logging;
using Microsoft.UI.Dispatching;
using Microsoft.VisualStudio.Threading;

namespace TaskNotes.Windows.App
{
    /// <summary>Owns asynchronous work started at synchronous WinUI event boundaries.</summary>
    internal sealed partial class UiOperationQueue
    {
        private readonly ILogger<UiOperationQueue> _logger;
        private readonly JoinableTaskCollection _tasks;
        private readonly JoinableTaskFactory _taskFactory;
        private readonly Action<Exception, string> _fatalHandler;

        internal UiOperationQueue(DispatcherQueue dispatcher, ILogger<UiOperationQueue> logger)
            : this(dispatcher, logger, CreateFatalHandler(dispatcher)) { }

        internal UiOperationQueue(
            DispatcherQueue dispatcher,
            ILogger<UiOperationQueue> logger,
            Action<Exception, string> fatalHandler
        )
        {
            ArgumentNullException.ThrowIfNull(dispatcher);
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
            _fatalHandler = fatalHandler ?? throw new ArgumentNullException(nameof(fatalHandler));
            JoinableTaskContext context = new();
            _tasks = context.CreateCollection();
            _taskFactory = context.CreateFactory(_tasks);
        }

        internal void Run(string operationName, Func<Task> operation)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(operationName);
            ArgumentNullException.ThrowIfNull(operation);
            _ = _taskFactory.RunAsync(async () =>
            {
                try
                {
                    await operation();
                }
                catch (Exception exception)
                {
                    LogFatalOperation(_logger, exception, operationName);
                    _fatalHandler(exception, operationName);
                }
            });
        }

        internal Task DrainAsync() => _tasks.JoinTillEmptyAsync();

        private static Action<Exception, string> CreateFatalHandler(DispatcherQueue dispatcher)
        {
            ArgumentNullException.ThrowIfNull(dispatcher);
            return (exception, operationName) =>
            {
                if (!dispatcher.TryEnqueue(() => ExceptionDispatchInfo.Capture(exception).Throw()))
                {
                    Environment.FailFast(
                        $"The UI dispatcher rejected fatal operation '{operationName}'.",
                        exception
                    );
                }
            };
        }

        [LoggerMessage(
            EventId = 1000,
            Level = LogLevel.Critical,
            Message = "Unexpected failure in UI operation {OperationName}."
        )]
        private static partial void LogFatalOperation(
            ILogger logger,
            Exception exception,
            string operationName
        );
    }
}
