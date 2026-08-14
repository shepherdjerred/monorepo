namespace TaskNotes.Windows.Host
{
    /// <summary>Describes the connection and synchronization state exposed to native UI.</summary>
    public enum TaskNotesSyncState
    {
        /// <summary>No server credentials are configured.</summary>
        Unconfigured,

        /// <summary>The durable cache is being restored.</summary>
        Loading,

        /// <summary>A synchronization pass is running.</summary>
        Synchronizing,

        /// <summary>The most recent synchronization pass succeeded.</summary>
        Connected,

        /// <summary>Cached data is available while the server is unreachable.</summary>
        CachedOffline,

        /// <summary>The server rejected the configured credentials.</summary>
        AuthenticationFailure,

        /// <summary>Synchronization failed for a reason other than connectivity or authentication.</summary>
        SynchronizationError,
    }

    /// <summary>A task row derived by the Rust core for the Today destination.</summary>
    public sealed record TodayTask
    {
        /// <summary>Initializes a Today task projection.</summary>
        public TodayTask(
            string id,
            string title,
            string? due,
            string? scheduled,
            bool isCompleted,
            bool isRecurring,
            bool isPending
        )
        {
            Id = id;
            Title = title;
            Due = due;
            Scheduled = scheduled;
            IsCompleted = isCompleted;
            IsRecurring = isRecurring;
            IsPending = isPending;
        }

        /// <summary>Gets the stable task identifier.</summary>
        public string Id { get; }

        /// <summary>Gets the task title.</summary>
        public string Title { get; }

        /// <summary>Gets the stored due value, when present.</summary>
        public string? Due { get; }

        /// <summary>Gets the stored scheduled value, when present.</summary>
        public string? Scheduled { get; }

        /// <summary>Gets whether the represented task or occurrence is complete.</summary>
        public bool IsCompleted { get; }

        /// <summary>Gets whether completion targets a recurring occurrence.</summary>
        public bool IsRecurring { get; }

        /// <summary>Gets whether an unsynchronized mutation targets this task.</summary>
        public bool IsPending { get; }

        /// <summary>Gets the quiet synchronization label shown beside the row.</summary>
        public string PendingLabel => IsPending ? "Pending" : string.Empty;
    }

    /// <summary>A mutation parked by the core for explicit retry or discard.</summary>
    public sealed record ParkedChange
    {
        /// <summary>Initializes a parked-change projection.</summary>
        public ParkedChange(
            string id,
            string errorName,
            string message,
            ushort? status,
            DateTimeOffset failedAt
        )
        {
            Id = id;
            ErrorName = errorName;
            Message = message;
            Status = status;
            FailedAt = failedAt;
        }

        /// <summary>Gets the mutation identifier.</summary>
        public string Id { get; }

        /// <summary>Gets the persisted error name.</summary>
        public string ErrorName { get; }

        /// <summary>Gets the error message.</summary>
        public string Message { get; }

        /// <summary>Gets the HTTP status associated with the failure, when present.</summary>
        public ushort? Status { get; }

        /// <summary>Gets when the mutation was parked.</summary>
        public DateTimeOffset FailedAt { get; }
    }

    /// <summary>An immutable UI-facing reading of the serialized synchronization engine.</summary>
    public sealed record TaskNotesState
    {
        /// <summary>Initializes an engine reading.</summary>
        public TaskNotesState(
            IReadOnlyList<TodayTask> todayTasks,
            IReadOnlySet<string> pendingIds,
            uint pendingCount,
            IReadOnlyList<ParkedChange> parkedChanges,
            TaskNotesSyncState syncState,
            string? userFacingError,
            DateTimeOffset? lastSyncTime
        )
        {
            TodayTasks = todayTasks;
            PendingIds = pendingIds;
            PendingCount = pendingCount;
            ParkedChanges = parkedChanges;
            SyncState = syncState;
            UserFacingError = userFacingError;
            LastSyncTime = lastSyncTime;
        }

        /// <summary>Gets the tasks admitted to Today by the core's date and recurrence rules.</summary>
        public IReadOnlyList<TodayTask> TodayTasks { get; init; }

        /// <summary>Gets the task identifiers with pending mutations.</summary>
        public IReadOnlySet<string> PendingIds { get; init; }

        /// <summary>Gets the number of queued mutations.</summary>
        public uint PendingCount { get; init; }

        /// <summary>Gets mutations that require user action.</summary>
        public IReadOnlyList<ParkedChange> ParkedChanges { get; init; }

        /// <summary>Gets the current UI synchronization state.</summary>
        public TaskNotesSyncState SyncState { get; init; }

        /// <summary>Gets the latest user-actionable error.</summary>
        public string? UserFacingError { get; init; }

        /// <summary>Gets the most recent successful pull time.</summary>
        public DateTimeOffset? LastSyncTime { get; init; }

        /// <summary>Gets the initial state before an engine is installed.</summary>
        public static TaskNotesState Unconfigured { get; } =
            new(
                [],
                new HashSet<string>(StringComparer.Ordinal),
                0,
                [],
                TaskNotesSyncState.Unconfigured,
                null,
                null
            );

        /// <summary>Gets every non-archived task in the optimistic snapshot.</summary>
        public IReadOnlyList<TaskItem> AllTasks { get; init; } = [];

        /// <summary>Gets the rows selected by the current reusable list query.</summary>
        public IReadOnlyList<TaskItem> VisibleTasks { get; init; } = [];

        /// <summary>Gets the current reusable list query.</summary>
        public TaskListQuery Query { get; init; } = TaskListQuery.Today;

        /// <summary>Gets every project in use.</summary>
        public IReadOnlyList<string> Projects { get; init; } = [];

        /// <summary>Gets every context in use.</summary>
        public IReadOnlyList<string> Contexts { get; init; } = [];

        /// <summary>Gets every tag in use.</summary>
        public IReadOnlyList<string> Tags { get; init; } = [];

        /// <summary>Gets the device-local saved views.</summary>
        public IReadOnlyList<SavedViewDefinition> SavedViews { get; init; } = [];

        /// <summary>Gets the selected task's live timing state.</summary>
        public TaskTimeReading? TaskTime { get; init; }

        /// <summary>Gets the latest aggregate time report.</summary>
        public TimeReportReading? TimeReport { get; init; }

        /// <summary>Gets the latest server-backed Pomodoro state.</summary>
        public PomodoroReading? Pomodoro { get; init; }

        /// <summary>Gets whether another completion can be undone.</summary>
        public bool CanUndoCompletion { get; init; }

        /// <summary>Gets the number of completion undo entries.</summary>
        public int CompletionUndoDepth { get; init; }
    }
}
