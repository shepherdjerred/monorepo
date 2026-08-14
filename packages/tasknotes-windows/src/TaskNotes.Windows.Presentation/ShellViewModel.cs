using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Presentation
{
    /// <summary>Portable state and commands for the main TaskNotes shell.</summary>
    public sealed partial class ShellViewModel : ObservableObject, IDisposable
    {
        private readonly ITaskNotesStore _store;
        private readonly IUiDispatcher _dispatcher;
        private readonly ILogger<ShellViewModel> _logger;
        private TaskNotesState _state;
        private NavigationRoute _route = NavigationRoute.Parse("today");
        private bool _disposed;

        /// <summary>Initializes shell state over the serialized store facade.</summary>
        public ShellViewModel(
            ITaskNotesStore store,
            IUiDispatcher dispatcher,
            ILogger<ShellViewModel> logger
        )
        {
            _store = store ?? throw new ArgumentNullException(nameof(store));
            _dispatcher = dispatcher ?? throw new ArgumentNullException(nameof(dispatcher));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
            _state = store.State;
            RefreshCommand = new AsyncRelayCommand(token =>
                ExecuteAsync("refresh", actionToken => _store.RefreshAsync(actionToken), token)
            );
            UndoCompletionCommand = new AsyncRelayCommand(
                token =>
                    ExecuteAsync(
                        "undo-completion",
                        actionToken => _store.UndoCompletionAsync(actionToken),
                        token
                    ),
                () => State.CanUndoCompletion
            );
            _store.StateChanged += StoreStateChanged;
            ApplyState();
        }

        /// <summary>Gets the latest store snapshot.</summary>
        public TaskNotesState State
        {
            get => _state;
            private set
            {
                if (SetProperty(ref _state, value))
                {
                    OnPropertyChanged(nameof(VisibleTasks));
                    OnPropertyChanged(nameof(SavedViews));
                    OnPropertyChanged(nameof(ParkedChanges));
                    OnPropertyChanged(nameof(StatusMessage));
                    OnPropertyChanged(nameof(StatusSeverity));
                    UndoCompletionCommand.NotifyCanExecuteChanged();
                }
            }
        }

        /// <summary>Gets the current destination descriptor.</summary>
        public NavigationRoute Route
        {
            get => _route;
            private set
            {
                if (SetProperty(ref _route, value))
                {
                    OnPropertyChanged(nameof(CurrentQuery));
                }
            }
        }

        /// <summary>Gets the current core-backed query.</summary>
        public TaskListQuery CurrentQuery => Route.Query ?? State.Query;

        /// <summary>Gets visible task rows.</summary>
        public IReadOnlyList<TaskItem> VisibleTasks => State.VisibleTasks;

        /// <summary>Gets saved-view navigation entries.</summary>
        public IReadOnlyList<SavedViewDefinition> SavedViews => State.SavedViews;

        /// <summary>Gets parked mutations.</summary>
        public IReadOnlyList<ParkedChange> ParkedChanges => State.ParkedChanges;

        /// <summary>Gets Open board rows.</summary>
        public ObservableCollection<TaskItem> OpenBoardTasks { get; } = [];

        /// <summary>Gets in-progress board rows.</summary>
        public ObservableCollection<TaskItem> InProgressBoardTasks { get; } = [];

        /// <summary>Gets waiting board rows.</summary>
        public ObservableCollection<TaskItem> WaitingBoardTasks { get; } = [];

        /// <summary>Gets delegated board rows.</summary>
        public ObservableCollection<TaskItem> DelegatedBoardTasks { get; } = [];

        /// <summary>Gets completed board rows.</summary>
        public ObservableCollection<TaskItem> DoneBoardTasks { get; } = [];

        /// <summary>Gets cancelled board rows.</summary>
        public ObservableCollection<TaskItem> CancelledBoardTasks { get; } = [];

        /// <summary>Gets the connection status announcement.</summary>
        public string StatusMessage
        {
            get
            {
                string pending =
                    State.PendingCount == 0 ? string.Empty : $" · {State.PendingCount} pending";
                string parked =
                    State.ParkedChanges.Count == 0
                        ? string.Empty
                        : $" · {State.ParkedChanges.Count} parked";
                string detail = State.UserFacingError is null
                    ? string.Empty
                    : $" · {State.UserFacingError}";
                return $"{State.SyncState}{pending}{parked}{detail}";
            }
        }

        /// <summary>Gets semantic status severity without a WinUI dependency.</summary>
        public PresentationStatusSeverity StatusSeverity =>
            State.SyncState switch
            {
                TaskNotesSyncState.AuthenticationFailure
                or TaskNotesSyncState.SynchronizationError => PresentationStatusSeverity.Error,
                TaskNotesSyncState.CachedOffline => PresentationStatusSeverity.Warning,
                TaskNotesSyncState.Connected => PresentationStatusSeverity.Success,
                TaskNotesSyncState.Unconfigured
                or TaskNotesSyncState.Loading
                or TaskNotesSyncState.Synchronizing => PresentationStatusSeverity.Information,
                _ => throw new InvalidOperationException(
                    $"Unknown synchronization state {State.SyncState}."
                ),
            };

        /// <summary>Gets the refresh command.</summary>
        public IAsyncRelayCommand RefreshCommand { get; }

        /// <summary>Gets the completion-undo command.</summary>
        public IAsyncRelayCommand UndoCompletionCommand { get; }

        /// <summary>Navigates and applies the destination query.</summary>
        public async Task NavigateAsync(string route, CancellationToken cancellationToken = default)
        {
            NavigationRoute next = NavigationRoute.Parse(route);
            if (next.Query is not null)
            {
                await _store.SetQueryAsync(next.Query, cancellationToken);
            }
            Route = next;
        }

        /// <summary>Applies search, sort, filter, or grouping state.</summary>
        public async Task ApplyQueryAsync(
            TaskListQuery query,
            CancellationToken cancellationToken = default
        )
        {
            ArgumentNullException.ThrowIfNull(query);
            await _store.SetQueryAsync(query, cancellationToken);
            Route = Route with { Query = query };
        }

        /// <summary>Moves a task between board columns.</summary>
        public Task MoveBoardTaskAsync(
            string taskId,
            string status,
            CancellationToken cancellationToken = default
        )
        {
            return _store.SetStatusAsync(taskId, status, cancellationToken);
        }

        /// <summary>Stops observing the store.</summary>
        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }
            _disposed = true;
            _store.StateChanged -= StoreStateChanged;
        }

        private async Task ExecuteAsync(
            string operation,
            Func<CancellationToken, Task> action,
            CancellationToken cancellationToken
        )
        {
            LogOperationStarted(_logger, operation);
            await action(cancellationToken);
            LogOperationCompleted(_logger, operation);
        }

        private void StoreStateChanged(object? sender, EventArgs eventArgs)
        {
            _ = sender;
            _ = eventArgs;
            if (_dispatcher.HasThreadAccess)
            {
                ApplyState();
            }
            else
            {
                _dispatcher.Enqueue(ApplyState);
            }
        }

        [LoggerMessage(
            EventId = 2000,
            Level = LogLevel.Debug,
            Message = "Starting presentation operation {Operation}."
        )]
        private static partial void LogOperationStarted(ILogger logger, string operation);

        [LoggerMessage(
            EventId = 2001,
            Level = LogLevel.Debug,
            Message = "Completed presentation operation {Operation}."
        )]
        private static partial void LogOperationCompleted(ILogger logger, string operation);

        private void ApplyState()
        {
            State = _store.State;
            Replace(OpenBoardTasks, State.AllTasks.Where(task => task.Status == "open"));
            Replace(
                InProgressBoardTasks,
                State.AllTasks.Where(task => task.Status == "in-progress")
            );
            Replace(WaitingBoardTasks, State.AllTasks.Where(task => task.Status == "waiting"));
            Replace(DelegatedBoardTasks, State.AllTasks.Where(task => task.Status == "delegated"));
            Replace(DoneBoardTasks, State.AllTasks.Where(task => task.Status == "done"));
            Replace(CancelledBoardTasks, State.AllTasks.Where(task => task.Status == "cancelled"));
        }

        private static void Replace<T>(ObservableCollection<T> target, IEnumerable<T> values)
        {
            target.Clear();
            foreach (T value in values)
            {
                target.Add(value);
            }
        }
    }

    /// <summary>Portable semantic severity mapped to platform colors by the view.</summary>
    public enum PresentationStatusSeverity
    {
        /// <summary>Neutral progress or configuration information.</summary>
        Information,

        /// <summary>Successful connection.</summary>
        Success,

        /// <summary>Offline cached state.</summary>
        Warning,

        /// <summary>Authentication or synchronization failure.</summary>
        Error,
    }
}
