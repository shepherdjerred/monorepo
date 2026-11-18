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

    /// <summary>A task row projected for the Today destination.</summary>
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

    /// <summary>A mutation parked after server rejection for explicit retry or discard.</summary>
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

    /// <summary>Nonsecret presentation identity for a retained action envelope.</summary>
    public sealed record FacetPendingAction(
        string Id,
        string ProfileId,
        string ProfileName,
        string Kind,
        bool CanResume = true
    );

    /// <summary>Native presentation ownership captured before a mutation starts.</summary>
    public sealed record FacetNoticeOwner(
        string ProfileId,
        string MutationId,
        long RequestGeneration,
        long EngineGeneration
    );

    /// <summary>A saved notice remains separate from mutation or maintenance errors.</summary>
    public sealed record FacetSavedNotice(FacetNoticeOwner Owner, IReadOnlyList<string> Messages)
    {
        /// <summary>Gets plain confirmation copy for the applied operation.</summary>
        public string Title { get; } = "Saved";

        /// <summary>Allows publication only while the exact native owner remains current.</summary>
        public bool BelongsTo(FacetNoticeOwner current) => Owner == current;
    }

    /// <summary>A projected Kanban column (either project sections or cross-project priorities).</summary>
    public sealed record FacetBoardColumnSnapshot(
        string Value,
        string Label,
        IReadOnlyList<TaskItem> Tasks,
        bool IsSectionColumn = false
    );

    /// <summary>A scheduled reminder firing computed from synced tasks and reminders.</summary>
    public sealed record FacetScheduledReminder(
        string NotificationId,
        string TaskId,
        string Title,
        string ReminderId,
        DateTimeOffset FireAt,
        string? Description
    );

    /// <summary>An immutable UI-facing reading of the serialized synchronization store.</summary>
    public sealed record TaskNotesState
    {
        internal long PublicationSequence { get; init; }

        /// <summary>Initializes a store reading.</summary>
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

        /// <summary>Gets the tasks admitted to Today by date and recurrence rules.</summary>
        public IReadOnlyList<TodayTask> TodayTasks { get; init; }

        /// <summary>Gets the task identifiers with pending mutations.</summary>
        public IReadOnlySet<string> PendingIds { get; init; }

        /// <summary>Gets the number of queued mutations.</summary>
        public uint PendingCount { get; init; }

        /// <summary>Gets mutations that require user action.</summary>
        public IReadOnlyList<ParkedChange> ParkedChanges { get; init; }

        /// <summary>Retained immutable actions requiring explicit owner-directed resumption.</summary>
        public IReadOnlyList<FacetPendingAction> FacetPendingActions { get; init; } = [];

        /// <summary>Gets the current UI synchronization state.</summary>
        public TaskNotesSyncState SyncState { get; init; }

        /// <summary>Gets the latest user-actionable error.</summary>
        public string? UserFacingError { get; init; }

        /// <summary>Gets an applied task's fixed warning copy, separate from errors.</summary>
        public FacetSavedNotice? SavedNotice { get; init; }

        /// <summary>Gets the current profile, action, request and engine presentation fence.</summary>
        public FacetNoticeOwner? SavedNoticeOwner { get; init; }

        /// <summary>Gets local maintenance information after a successful applied action.</summary>
        public string? SavedMaintenance { get; init; }

        /// <summary>Gets the most recent successful synchronization time.</summary>
        public DateTimeOffset? LastSyncTime { get; init; }

        /// <summary>Gets the initial state before server configuration is installed.</summary>
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

        /// <summary>Gets every non-deleted task in the optimistic snapshot.</summary>
        public IReadOnlyList<TaskItem> AllTasks { get; init; } = [];

        /// <summary>Gets the rows selected by the current reusable list query.</summary>
        public IReadOnlyList<TaskItem> VisibleTasks { get; init; } = [];

        /// <summary>Gets the current reusable list query.</summary>
        public TaskListQuery Query { get; init; } = TaskListQuery.Today;

        /// <summary>Gets every project name in use.</summary>
        public IReadOnlyList<string> Projects { get; init; } = [];

        /// <summary>Gets every context in use.</summary>
        public IReadOnlyList<string> Contexts { get; init; } = [];

        /// <summary>Gets every tag/label in use.</summary>
        public IReadOnlyList<string> Tags { get; init; } = [];

        /// <summary>Open workflow choices.</summary>
        public IReadOnlyList<WorkflowChoice> StatusChoices { get; init; } = [];

        /// <summary>Open priority choices.</summary>
        public IReadOnlyList<WorkflowChoice> PriorityChoices { get; init; } = [];

        /// <summary>Gets projected Todoist-style Kanban board columns for the current scope.</summary>
        public IReadOnlyList<FacetBoardColumnSnapshot> BoardColumns { get; init; } = [];

        /// <summary>Gets upcoming reminder firings derived from active tasks and reminders.</summary>
        public IReadOnlyList<FacetScheduledReminder> ScheduledReminders { get; init; } = [];

        /// <summary>Gets the synced saved views (`Filter` entities).</summary>
        public IReadOnlyList<SavedViewDefinition> SavedViews { get; init; } = [];

        /// <summary>Gets whether another completion can be undone.</summary>
        public bool CanUndoCompletion { get; init; }

        /// <summary>Gets the number of completion undo entries.</summary>
        public int CompletionUndoDepth { get; init; }
    }

    /// <summary>A configured wire value and its display label.</summary>
    public sealed record WorkflowChoice(string Value, string Label)
    {
        /// <summary>Exact configured presentation color, preserved independently from workflow meaning.</summary>
        public string? Color { get; init; }
    }
}
