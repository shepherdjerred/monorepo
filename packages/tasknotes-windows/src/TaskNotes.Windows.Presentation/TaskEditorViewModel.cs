using CommunityToolkit.Mvvm.ComponentModel;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Presentation
{
    /// <summary>Portable editable task state with validation and dirty tracking.</summary>
    public sealed class TaskEditorViewModel : ObservableObject, IDisposable
    {
        private readonly ITaskNotesStore _store;
        private readonly IUiDispatcher _dispatcher;
        private TaskItem? _original;
        private string _title = string.Empty;
        private string? _details;
        private string _status = "open";
        private string _priority = "normal";
        private string? _due;
        private string? _scheduled;
        private string? _recurrence;
        private string? _recurrenceAnchor;
        private string _projects = string.Empty;
        private string _contexts = string.Empty;
        private string _tags = string.Empty;
        private uint? _timeEstimate;
        private string? _validationError;
        private bool _isDirty;
        private bool _loading;
        private bool _disposed;

        /// <summary>Initializes the task editor over the store facade.</summary>
        public TaskEditorViewModel(ITaskNotesStore store, IUiDispatcher dispatcher)
        {
            _store = store ?? throw new ArgumentNullException(nameof(store));
            _dispatcher = dispatcher ?? throw new ArgumentNullException(nameof(dispatcher));
            _store.StateChanged += StoreStateChanged;
        }

        /// <summary>Gets whether a task is loaded.</summary>
        public bool IsLoaded => _original is not null;

        /// <summary>Gets the edited task identifier.</summary>
        public string? TaskId => _original?.Id;

        /// <summary>Gets or sets the title.</summary>
        public string Title
        {
            get => _title;
            set => SetEditorProperty(ref _title, value);
        }

        /// <summary>Gets or sets Markdown details.</summary>
        public string? Details
        {
            get => _details;
            set => SetEditorProperty(ref _details, value);
        }

        /// <summary>Gets or sets the status wire value.</summary>
        public string Status
        {
            get => _status;
            set => SetEditorProperty(ref _status, value);
        }

        /// <summary>Gets or sets the priority wire value.</summary>
        public string Priority
        {
            get => _priority;
            set => SetEditorProperty(ref _priority, value);
        }

        /// <summary>Gets or sets the due value.</summary>
        public string? Due
        {
            get => _due;
            set => SetEditorProperty(ref _due, value);
        }

        /// <summary>Gets or sets the planned value.</summary>
        public string? Scheduled
        {
            get => _scheduled;
            set => SetEditorProperty(ref _scheduled, value);
        }

        /// <summary>Gets or sets the recurrence rule.</summary>
        public string? Recurrence
        {
            get => _recurrence;
            set => SetEditorProperty(ref _recurrence, value);
        }

        /// <summary>Gets or sets the recurrence anchor.</summary>
        public string? RecurrenceAnchor
        {
            get => _recurrenceAnchor;
            set => SetEditorProperty(ref _recurrenceAnchor, value);
        }

        /// <summary>Gets or sets comma-separated projects.</summary>
        public string Projects
        {
            get => _projects;
            set => SetEditorProperty(ref _projects, value);
        }

        /// <summary>Gets or sets comma-separated contexts.</summary>
        public string Contexts
        {
            get => _contexts;
            set => SetEditorProperty(ref _contexts, value);
        }

        /// <summary>Gets or sets comma-separated tags.</summary>
        public string Tags
        {
            get => _tags;
            set => SetEditorProperty(ref _tags, value);
        }

        /// <summary>Gets or sets the estimate in minutes.</summary>
        public uint? TimeEstimate
        {
            get => _timeEstimate;
            set
            {
                if (SetEditorProperty(ref _timeEstimate, value))
                {
                    OnPropertyChanged(nameof(EstimateValue));
                }
            }
        }

        /// <summary>Gets or sets the estimate as a NumberBox-compatible value.</summary>
        public double EstimateValue
        {
            get => TimeEstimate is uint estimate ? estimate : double.NaN;
            set => TimeEstimate = double.IsNaN(value) ? null : checked((uint)Math.Round(value));
        }

        /// <summary>Gets dependency warnings for the loaded task.</summary>
        public string DependencyLabel =>
            _original is { IsBlocked: true } ? "Blocked by another task"
            : _original is { IsBlocking: true } ? "Blocking another task"
            : "No dependency warnings";

        /// <summary>Gets tracked minutes for the loaded task.</summary>
        public string TrackedTimeLabel =>
            _original is null ? string.Empty : $"Tracked: {_original.TotalTrackedTime} minutes";

        /// <summary>Gets the current timing command label.</summary>
        public string TimerLabel => IsTimerActive ? "Stop timer" : "Start timer";

        /// <summary>Gets whether the loaded task has a live timing session.</summary>
        public bool IsTimerActive
        {
            get
            {
                if (TaskId is not string taskId)
                {
                    return false;
                }
                return
                    _store.State.TaskTime is { } live
                    && string.Equals(live.TaskId, taskId, StringComparison.Ordinal)
                    ? live.HasActiveSession
                    : _original?.HasActiveTimeSession == true;
            }
        }

        /// <summary>Gets the current validation message.</summary>
        public string? ValidationError
        {
            get => _validationError;
            private set => SetProperty(ref _validationError, value);
        }

        /// <summary>Gets whether values differ from the loaded snapshot.</summary>
        public bool IsDirty
        {
            get => _isDirty;
            private set => SetProperty(ref _isDirty, value);
        }

        /// <summary>Loads one immutable task snapshot.</summary>
        public void Load(TaskItem task)
        {
            ArgumentNullException.ThrowIfNull(task);
            _loading = true;
            try
            {
                _original = task;
                Title = task.Title;
                Details = task.Details;
                Status = task.Status;
                Priority = task.Priority;
                Due = task.Due;
                Scheduled = task.Scheduled;
                Recurrence = task.Recurrence;
                RecurrenceAnchor = task.RecurrenceAnchor;
                Projects = string.Join(", ", task.Projects);
                Contexts = string.Join(", ", task.Contexts);
                Tags = string.Join(", ", task.Tags);
                TimeEstimate = task.TimeEstimate;
                ValidationError = null;
                IsDirty = false;
                OnPropertyChanged(nameof(IsLoaded));
                OnPropertyChanged(nameof(TaskId));
                OnPropertyChanged(nameof(EstimateValue));
                OnPropertyChanged(nameof(DependencyLabel));
                OnPropertyChanged(nameof(TrackedTimeLabel));
                NotifyTimingChanged();
            }
            finally
            {
                _loading = false;
            }
        }

        /// <summary>Saves the complete edit through the core-backed store.</summary>
        public async Task<bool> SaveAsync(CancellationToken cancellationToken = default)
        {
            TaskItem original =
                _original
                ?? throw new InvalidOperationException("Load a task before saving the editor.");
            string title = Title.Trim();
            if (title.Length == 0)
            {
                ValidationError = "A task title is required.";
                return false;
            }
            ValidationError = null;
            await _store.UpdateTaskAsync(
                new TaskEditInput
                {
                    Id = original.Id,
                    Title = title,
                    Details = BlankAsNull(Details),
                    Status = Status,
                    Priority = Priority,
                    Due = BlankAsNull(Due),
                    Scheduled = BlankAsNull(Scheduled),
                    Recurrence = BlankAsNull(Recurrence),
                    RecurrenceAnchor = BlankAsNull(RecurrenceAnchor),
                    Projects = SplitValues(Projects),
                    Contexts = SplitValues(Contexts),
                    Tags = SplitValues(Tags),
                    TimeEstimate = TimeEstimate,
                },
                cancellationToken
            );
            IsDirty = false;
            return true;
        }

        /// <summary>Deletes the loaded task.</summary>
        public Task DeleteAsync(CancellationToken cancellationToken = default)
        {
            string taskId =
                TaskId ?? throw new InvalidOperationException("Load a task before deleting it.");
            return _store.DeleteTaskAsync(taskId, cancellationToken);
        }

        /// <summary>Starts or stops live server-backed timing for the loaded task.</summary>
        public Task ToggleTimeAsync(CancellationToken cancellationToken = default)
        {
            string taskId =
                TaskId ?? throw new InvalidOperationException("Load a task before timing it.");
            return IsTimerActive
                ? _store.StopTimeTrackingAsync(taskId, cancellationToken)
                : _store.StartTimeTrackingAsync(taskId, cancellationToken);
        }

        /// <summary>Loads live timing details for the current task.</summary>
        public Task LoadTimeAsync(CancellationToken cancellationToken = default)
        {
            string taskId =
                TaskId ?? throw new InvalidOperationException("Load a task before reading timing.");
            return _store.LoadTaskTimeAsync(taskId, cancellationToken);
        }

        /// <summary>Restores the original values without persisting.</summary>
        public void Discard()
        {
            Load(
                _original
                    ?? throw new InvalidOperationException("Load a task before discarding edits.")
            );
        }

        /// <summary>Clears the editor.</summary>
        public void Clear()
        {
            _original = null;
            _loading = true;
            try
            {
                Title = string.Empty;
                Details = null;
                Status = "open";
                Priority = "normal";
                Due = null;
                Scheduled = null;
                Recurrence = null;
                RecurrenceAnchor = null;
                Projects = string.Empty;
                Contexts = string.Empty;
                Tags = string.Empty;
                TimeEstimate = null;
                ValidationError = null;
                IsDirty = false;
                OnPropertyChanged(nameof(IsLoaded));
                OnPropertyChanged(nameof(TaskId));
                OnPropertyChanged(nameof(EstimateValue));
                OnPropertyChanged(nameof(DependencyLabel));
                OnPropertyChanged(nameof(TrackedTimeLabel));
                NotifyTimingChanged();
            }
            finally
            {
                _loading = false;
            }
        }

        /// <summary>Stops observing live timing state.</summary>
        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }
            _disposed = true;
            _store.StateChanged -= StoreStateChanged;
        }

        private bool SetEditorProperty<T>(
            ref T field,
            T value,
            [System.Runtime.CompilerServices.CallerMemberName] string? name = null
        )
        {
            bool changed = SetProperty(ref field, value, name);
            if (changed && !_loading)
            {
                IsDirty = true;
            }
            return changed;
        }

        private void StoreStateChanged(object? sender, EventArgs eventArgs)
        {
            _ = sender;
            _ = eventArgs;
            if (_dispatcher.HasThreadAccess)
            {
                NotifyTimingChanged();
            }
            else
            {
                _dispatcher.Enqueue(NotifyTimingChanged);
            }
        }

        private void NotifyTimingChanged()
        {
            OnPropertyChanged(nameof(IsTimerActive));
            OnPropertyChanged(nameof(TimerLabel));
        }

        private static string? BlankAsNull(string? value)
        {
            return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        }

        private static IReadOnlyList<string> SplitValues(string value)
        {
            return
            [
                .. value
                    .Split(
                        ',',
                        StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries
                    )
                    .Distinct(StringComparer.Ordinal),
            ];
        }
    }
}
