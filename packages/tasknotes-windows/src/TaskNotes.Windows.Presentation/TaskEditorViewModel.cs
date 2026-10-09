using CommunityToolkit.Mvvm.ComponentModel;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Presentation
{
    /// <summary>Portable editable task state with validation and dirty tracking.</summary>
    public sealed partial class TaskEditorViewModel : ObservableObject, IDisposable
    {
        /// <summary>Configured open workflow values from the selected vault.</summary>
        public IReadOnlyList<WorkflowChoice> StatusChoices =>
            _original is null ? _store.State.StatusChoices : _statusChoices;

        /// <summary>Configured open priority values from the selected vault.</summary>
        public IReadOnlyList<WorkflowChoice> PriorityChoices =>
            _original is null ? _store.State.PriorityChoices : _priorityChoices;

        /// <summary>Unsupported colors are reported per choice without changing its raw workflow value.</summary>
        public string StatusColorWarning =>
            ConfiguredColor.Diagnostic(
                StatusChoices.SingleOrDefault(choice => choice.Value == Status)?.Color
            );

        /// <summary>Unsupported priority colors use the native neutral foreground.</summary>
        public string PriorityColorWarning =>
            ConfiguredColor.Diagnostic(
                PriorityChoices.SingleOrDefault(choice => choice.Value == Priority)?.Color
            );

        /// <summary>Native token suggestions come from the current core projection, never a second taxonomy store.</summary>
        public IReadOnlyList<string> TokenSuggestions(string field, string text)
        {
            var options = field switch
            {
                "projects" => _store.State.Projects,
                "contexts" => _store.State.Contexts,
                "tags" => _store.State.Tags,
                _ => throw new ArgumentOutOfRangeException(nameof(field)),
            };
            string[] tokens = text.Split(',');
            string prefix = tokens[^1].Trim();
            var existing = tokens
                .SkipLast(1)
                .Select(value => value.Trim())
                .ToHashSet(StringComparer.Ordinal);
            return options
                .Where(value =>
                    !existing.Contains(value)
                    && value.Contains(prefix, StringComparison.OrdinalIgnoreCase)
                )
                .Take(20)
                .ToArray();
        }

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
        private string? _validationError;
        private bool _isDirty;
        private bool _loading;
        private bool _disposed;
        private long _draftGeneration;
        private readonly SemaphoreSlim _commits = new(1, 1);
        private long _ownerGeneration;
        private bool _isCommitting;
        private string? _commitError;
        private bool _needsObservation;
        private string? _recoveryActionId;
        private readonly Dictionary<(string? Profile, string Task), string> _retainedEdits = [];

        /// <summary>Exact submitted envelope; Resume/Retire remains owned by the existing recovery surface.</summary>
        public string? RecoveryActionId
        {
            get => _recoveryActionId;
            private set => SetProperty(ref _recoveryActionId, value);
        }

        /// <summary>Only this inspector's serialized commit is busy; other task actions remain available.</summary>
        public bool IsCommitting
        {
            get => _isCommitting;
            private set => SetProperty(ref _isCommitting, value);
        }

        /// <summary>A failed draft remains visible until Retry or Discard.</summary>
        public string? CommitError
        {
            get => _commitError;
            private set => SetProperty(ref _commitError, value);
        }

        /// <summary>An applied receipt whose projection failed must be observed, never resubmitted.</summary>
        public bool NeedsObservation
        {
            get => _needsObservation;
            private set => SetProperty(ref _needsObservation, value);
        }

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

        /// <summary>Vault owner is retained with the draft, never inferred from current selection.</summary>
        public string? ProfileId => _original?.ProfileId;

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

        /// <summary>Editable taxonomy chips retain exact case-sensitive wire tokens.</summary>
        public IReadOnlyList<string> ProjectsTokens => SplitValues(Projects);

        /// <summary>Context chips.</summary>
        public IReadOnlyList<string> ContextsTokens => SplitValues(Contexts);

        /// <summary>Tag chips.</summary>
        public IReadOnlyList<string> TagsTokens => SplitValues(Tags);

        /// <summary>Gets dependency warnings for the loaded task.</summary>
        public string DependencyLabel =>
            _original is { IsBlocked: true } ? "Blocked by another task"
            : _original is { IsBlocking: true } ? "Blocking another task"
            : "No dependency warnings";

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
        public void Load(TaskItem task) => LoadSnapshot(task, true);

        private void LoadSnapshot(TaskItem task, bool fence)
        {
            if (fence)
                _ownerGeneration++;
            _draftGeneration++;
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
                LoadAdditionalFields(task);
                ValidationError = null;
                CommitError = null;
                NeedsObservation = false;
                RecoveryActionId = null;
                if (
                    fence && _retainedEdits.TryGetValue((task.ProfileId, task.Id), out var retained)
                )
                {
                    if (
                        _store.State.FacetPendingActions.Any(action =>
                            action.Id == retained && action.ProfileId == task.ProfileId
                        )
                    )
                    {
                        RecoveryActionId = retained;
                        CommitError =
                            "This submitted action is retained. Resume or retire it in Settings before offering another edit.";
                    }
                    else
                        _retainedEdits.Remove((task.ProfileId, task.Id));
                }
                IsDirty = false;
                OnPropertyChanged(nameof(IsLoaded));
                OnPropertyChanged(nameof(TaskId));
                OnPropertyChanged(nameof(DependencyLabel));
                NotifyWorkflowChoicesChanged();
            }
            finally
            {
                _loading = false;
            }
        }

        /// <summary>Saves the complete edit through the core-backed store.</summary>
        public async Task<bool> SaveAsync(CancellationToken cancellationToken = default) =>
            await CommitAsync(null, cancellationToken);

        /// <summary>Offer one field on Return, blur or control change without saving unrelated text buffers.</summary>
        public Task<bool> CommitFieldAsync(
            string field,
            CancellationToken cancellationToken = default
        )
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(field);
            if (field != "reminders" && !Buffers().ContainsKey(field))
                throw new ArgumentOutOfRangeException(
                    nameof(field),
                    field,
                    "Unknown editor field."
                );
            return CommitAsync(field, cancellationToken);
        }

        private async Task<bool> CommitAsync(string? field, CancellationToken cancellationToken)
        {
            long owner = _ownerGeneration;
            await _commits.WaitAsync(cancellationToken);
            try
            {
                if (_disposed || owner != _ownerGeneration)
                    return false;
                ReconcileResolvedRecovery();
                if (NeedsObservation || RecoveryActionId is not null)
                    return false;
                IsCommitting = true;
                CommitError = null;
                return await SaveCoreAsync(field, owner, cancellationToken);
            }
            catch (Exception error)
            {
                string? message = TaskNotesExceptionPolicy.UserFacingMessage(error);
                if (message is null)
                    throw;
                if (!_disposed && owner == _ownerGeneration && RecoveryActionId is null)
                    CommitError = message;
                throw;
            }
            finally
            {
                IsCommitting = false;
                _commits.Release();
            }
        }

        private async Task<bool> SaveCoreAsync(
            string? field,
            long owner,
            CancellationToken cancellationToken
        )
        {
            TaskItem original =
                _original
                ?? throw new InvalidOperationException("Load a task before saving the editor.");
            string title = Title.Trim();
            if (title.Length == 0 && field is null or "title")
            {
                ValidationError = "A task title is required.";
                return false;
            }
            ValidationError = null;
            long draftGeneration = _draftGeneration;
            var submittedBuffers = Buffers();
            string submittedReminders = ReminderFingerprint();
            var changes = ChangedFields(original, title, field is null or "reminders");
            bool bodyChanged = !string.Equals(Details, original.Details, StringComparison.Ordinal);
            if (field is not null)
            {
                changes = changes
                    .Where(pair => pair.Key == field)
                    .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
                bodyChanged &= field == "body";
            }
            if (changes.Count == 0 && !bodyChanged)
            {
                if (field is null)
                    IsDirty = false;
                return true;
            }
            TaskEditInput input = new()
            {
                Id = original.Id,
                ProfileId = original.ProfileId,
                ExpectedRevision = original.ExpectedRevision,
                OccurrenceDate = original.OccurrenceDate,
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
                ChangedProperties = changes,
                BodyChanged = bodyChanged,
            };
            string? admittedAction = null;
            try
            {
                if (_store is IFacetTaskEditorStore standalone)
                {
                    TaskItem saved = await standalone.SaveTaskEditAsync(
                        input,
                        id => admittedAction = id,
                        cancellationToken
                    );
                    if (_disposed || owner != _ownerGeneration)
                        return true;
                    AcceptSaved(original, saved, field, submittedBuffers, submittedReminders);
                }
                else
                {
                    await _store.UpdateTaskAsync(input, cancellationToken);
                    if (_disposed || owner != _ownerGeneration)
                        return true;
                    TaskItem? saved = _store.State.AllTasks.SingleOrDefault(task =>
                        task.Id == original.Id && task.ProfileId == original.ProfileId
                    );
                    if (saved is not null)
                        AcceptSaved(original, saved, field, submittedBuffers, submittedReminders);
                }
            }
            catch (FacetSavedObservationException)
            {
                // Applied is authoritative; retain the draft until a fresh projection is available.
                if (!_disposed && owner == _ownerGeneration)
                {
                    NeedsObservation = true;
                    RecoveryActionId = admittedAction;
                    if (admittedAction is not null)
                        _retainedEdits[(original.ProfileId, original.Id)] = admittedAction;
                    CommitError =
                        "Saved; refresh to observe the result before editing again. Review recovery in Settings if needed.";
                }
                return true;
            }
            catch
            {
                if (
                    !_disposed
                    && owner == _ownerGeneration
                    && admittedAction is not null
                    && _store.State.FacetPendingActions.Any(action =>
                        action.Id == admittedAction && action.ProfileId == original.ProfileId
                    )
                )
                {
                    RecoveryActionId = admittedAction;
                    _retainedEdits[(original.ProfileId, original.Id)] = admittedAction;
                    CommitError =
                        "This submitted action is retained. Resume or retire it in Settings before offering another edit.";
                }
                throw;
            }
            if (
                field is null
                && draftGeneration == _draftGeneration
                && _store is not IFacetTaskEditorStore
            )
                IsDirty = false;
            return true;
        }

        private void AcceptSaved(
            TaskItem original,
            TaskItem saved,
            string? field,
            Dictionary<string, string?> submitted,
            string submittedReminders,
            bool acknowledged = true
        )
        {
            var before = Baseline(original);
            var retained = Buffers()
                .Where(pair =>
                    pair.Value != before[pair.Key]
                    && (
                        !acknowledged
                        || !(
                            (field is null || field == pair.Key)
                            && pair.Value == submitted[pair.Key]
                        )
                    )
                )
                .ToArray();
            string currentReminders = ReminderFingerprint();
            bool retainReminders =
                currentReminders != _reminderBaseline
                && (
                    !acknowledged
                    || !((field is null or "reminders") && currentReminders == submittedReminders)
                );
            var reminderRows = Reminders.ToArray();
            // Refresh untouched fields from the authoritative resulting task. Preserve only
            // unsent or newer buffers, so an external update cannot become a false local edit.
            LoadSnapshot(saved, false);
            foreach (var pair in retained)
                RestoreBuffer(pair.Key, pair.Value);
            if (retainReminders)
            {
                Reminders.Clear();
                foreach (var row in reminderRows)
                    Reminders.Add(row);
                IsDirty = true;
            }
            var baseline = Baseline(saved);
            IsDirty =
                Buffers().Any(pair => pair.Value != baseline[pair.Key])
                || ReminderFingerprint() != _reminderBaseline;
        }

        private void ReconcileResolvedRecovery()
        {
            if (
                RecoveryActionId is not string id
                || _original is not { } original
                || IsCommitting
                || _store.State.FacetPendingActions.Any(action => action.Id == id)
            )
                return;
            var current = _store.State.AllTasks.SingleOrDefault(task =>
                task.Id == original.Id && task.ProfileId == original.ProfileId
            );
            if (current is null)
                return;
            _retainedEdits.Remove((original.ProfileId, original.Id));
            // Exact recovery has removed the journal envelope. Rebase against its fresh
            // projection while preserving genuinely dirty buffers, never resubmitting old bytes.
            AcceptSaved(
                original,
                current,
                null,
                Buffers(),
                ReminderFingerprint(),
                acknowledged: false
            );
        }

        /// <summary>Deletes the loaded task.</summary>
        public Task DeleteAsync(CancellationToken cancellationToken = default)
        {
            string taskId =
                TaskId ?? throw new InvalidOperationException("Load a task before deleting it.");
            return _store.DeleteTaskAsync(taskId, cancellationToken);
        }

        /// <summary>Restores the original values without persisting.</summary>
        public void Discard()
        {
            var original =
                _original
                ?? throw new InvalidOperationException("Load a task before discarding edits.");
            var current = _store.State.AllTasks.SingleOrDefault(task =>
                task.Id == original.Id && task.ProfileId == original.ProfileId
            );
            Load(current ?? original);
        }

        /// <summary>Clears the editor.</summary>
        public void Clear()
        {
            _ownerGeneration++;
            _draftGeneration++;
            _original = null;
            _loading = true;
            try
            {
                Title = string.Empty;
                Details = null;
                Status = string.Empty;
                Priority = string.Empty;
                Due = null;
                Scheduled = null;
                Recurrence = null;
                RecurrenceAnchor = null;
                Projects = string.Empty;
                Contexts = string.Empty;
                Tags = string.Empty;
                ClearAdditionalFields();
                ValidationError = null;
                CommitError = null;
                NeedsObservation = false;
                RecoveryActionId = null;
                IsDirty = false;
                OnPropertyChanged(nameof(IsLoaded));
                OnPropertyChanged(nameof(TaskId));
                OnPropertyChanged(nameof(DependencyLabel));
                NotifyWorkflowChoicesChanged();
            }
            finally
            {
                _loading = false;
            }
        }

        /// <summary>Stops observing store state and fences late commits.</summary>
        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }
            _disposed = true;
            _ownerGeneration++;
            _draftGeneration++;
            _store.StateChanged -= StoreStateChanged;
        }

        private bool SetEditorProperty<T>(
            ref T field,
            T value,
            [System.Runtime.CompilerServices.CallerMemberName] string? name = null
        )
        {
            bool changed = SetProperty(ref field, value, name);
            if (changed && name is nameof(Projects) or nameof(Contexts) or nameof(Tags))
                OnPropertyChanged(name + "Tokens");
            if (changed && name is nameof(Status) or nameof(Priority))
                OnPropertyChanged(name + "ColorWarning");
            if (changed && !_loading)
            {
                _draftGeneration++;
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
                NotifyWorkflowChoicesChanged();
            }
            else
            {
                _dispatcher.Enqueue(NotifyWorkflowChoicesChanged);
            }
        }

        private void NotifyWorkflowChoicesChanged()
        {
            if (_disposed)
                return;
            ReconcileResolvedRecovery();
            OnPropertyChanged(nameof(StatusChoices));
            OnPropertyChanged(nameof(PriorityChoices));
            OnPropertyChanged(nameof(StatusColorWarning));
            OnPropertyChanged(nameof(PriorityColorWarning));
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
