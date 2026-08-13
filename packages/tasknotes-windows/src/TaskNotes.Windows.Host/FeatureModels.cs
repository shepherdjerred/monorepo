namespace TaskNotes.Windows.Host
{
    /// <summary>The reusable task-list destinations exposed by the Windows shell.</summary>
    public enum TaskListKind
    {
        /// <summary>Untriaged active tasks.</summary>
        Inbox,

        /// <summary>Tasks due, scheduled, overdue, or recurring today.</summary>
        Today,

        /// <summary>Future dated tasks and occurrences.</summary>
        Upcoming,

        /// <summary>The non-archived corpus.</summary>
        Browse,

        /// <summary>Completed tasks.</summary>
        Completed,

        /// <summary>Tasks scoped to one project.</summary>
        Project,

        /// <summary>Tasks scoped to one context.</summary>
        Context,

        /// <summary>Tasks scoped to one tag.</summary>
        Tag,

        /// <summary>Tasks scoped by a saved view.</summary>
        SavedView,

        /// <summary>The status-column board.</summary>
        Board,
    }

    /// <summary>A task-list sort exposed by the shell and implemented by the core.</summary>
    public enum TaskSortChoice
    {
        /// <summary>Keep the engine snapshot order.</summary>
        AsSynchronized,

        /// <summary>Sort by effective date.</summary>
        EffectiveDate,

        /// <summary>Sort by due date.</summary>
        DueDate,

        /// <summary>Sort by priority.</summary>
        Priority,

        /// <summary>Sort by title.</summary>
        Title,
    }

    /// <summary>A presentation grouping applied after core filtering and sorting.</summary>
    public enum TaskGroupChoice
    {
        /// <summary>Show one flat list.</summary>
        None,

        /// <summary>Group by the core's civil-date buckets.</summary>
        Date,

        /// <summary>Group by status.</summary>
        Status,

        /// <summary>Group by priority.</summary>
        Priority,

        /// <summary>Group by the first project.</summary>
        Project,
    }

    /// <summary>The complete query state for the reusable task-list workspace.</summary>
    public sealed record TaskListQuery
    {
        /// <summary>Initializes an unfiltered query for a destination.</summary>
        public TaskListQuery(TaskListKind kind, string? scope = null)
        {
            Kind = kind;
            Scope = scope;
        }

        /// <summary>Gets the destination membership rule.</summary>
        public TaskListKind Kind { get; init; }

        /// <summary>Gets the project, context, tag, or saved-view identifier.</summary>
        public string? Scope { get; init; }

        /// <summary>Gets the free-text search phrase.</summary>
        public string Search { get; init; } = string.Empty;

        /// <summary>Gets the selected status wire values.</summary>
        public IReadOnlyList<string> Statuses { get; init; } = [];

        /// <summary>Gets the selected priority wire values.</summary>
        public IReadOnlyList<string> Priorities { get; init; } = [];

        /// <summary>Gets the selected projects.</summary>
        public IReadOnlyList<string> Projects { get; init; } = [];

        /// <summary>Gets the selected contexts.</summary>
        public IReadOnlyList<string> Contexts { get; init; } = [];

        /// <summary>Gets the selected tags.</summary>
        public IReadOnlyList<string> Tags { get; init; } = [];

        /// <summary>Gets whether only tasks without a due date are shown.</summary>
        public bool HasNoDueDate { get; init; }

        /// <summary>Gets the selected sort.</summary>
        public TaskSortChoice Sort { get; init; } = TaskSortChoice.AsSynchronized;

        /// <summary>Gets whether the selected sort is descending.</summary>
        public bool Descending { get; init; }

        /// <summary>Gets the presentation grouping.</summary>
        public TaskGroupChoice Group { get; init; }

        /// <summary>Gets the default Today query.</summary>
        public static TaskListQuery Today { get; } = new(TaskListKind.Today);
    }

    /// <summary>A UI-facing task containing domain values supplied by the core.</summary>
    public sealed record TaskItem
    {
        /// <summary>Initializes a projected task.</summary>
        public TaskItem(
            string id,
            string title,
            string? details,
            string status,
            string statusLabel,
            string priority,
            string priorityLabel,
            string? due,
            string? scheduled,
            string? recurrence,
            string? recurrenceAnchor,
            IReadOnlyList<string> projects,
            IReadOnlyList<string> contexts,
            IReadOnlyList<string> tags,
            uint? timeEstimate,
            uint totalTrackedTime,
            bool isBlocked,
            bool isBlocking,
            bool isCompleted,
            bool isRecurring,
            bool isPending,
            string? occurrenceDate,
            string groupLabel,
            bool hasActiveTimeSession
        )
        {
            Id = id;
            Title = title;
            Details = details;
            Status = status;
            StatusLabel = statusLabel;
            Priority = priority;
            PriorityLabel = priorityLabel;
            Due = due;
            Scheduled = scheduled;
            Recurrence = recurrence;
            RecurrenceAnchor = recurrenceAnchor;
            Projects = projects;
            Contexts = contexts;
            Tags = tags;
            TimeEstimate = timeEstimate;
            TotalTrackedTime = totalTrackedTime;
            IsBlocked = isBlocked;
            IsBlocking = isBlocking;
            IsCompleted = isCompleted;
            IsRecurring = isRecurring;
            IsPending = isPending;
            OccurrenceDate = occurrenceDate;
            GroupLabel = groupLabel;
            HasActiveTimeSession = hasActiveTimeSession;
        }

        /// <summary>Gets the stable task identifier.</summary>
        public string Id { get; }

        /// <summary>Gets the title.</summary>
        public string Title { get; }

        /// <summary>Gets the Markdown details.</summary>
        public string? Details { get; }

        /// <summary>Gets the status wire value.</summary>
        public string Status { get; }

        /// <summary>Gets the localized core status label.</summary>
        public string StatusLabel { get; }

        /// <summary>Gets the priority wire value.</summary>
        public string Priority { get; }

        /// <summary>Gets the localized core priority label.</summary>
        public string PriorityLabel { get; }

        /// <summary>Gets the stored due value.</summary>
        public string? Due { get; }

        /// <summary>Gets the stored scheduled value.</summary>
        public string? Scheduled { get; }

        /// <summary>Gets the recurrence rule.</summary>
        public string? Recurrence { get; }

        /// <summary>Gets the recurrence anchor wire value.</summary>
        public string? RecurrenceAnchor { get; }

        /// <summary>Gets the projects.</summary>
        public IReadOnlyList<string> Projects { get; }

        /// <summary>Gets the contexts.</summary>
        public IReadOnlyList<string> Contexts { get; }

        /// <summary>Gets the tags.</summary>
        public IReadOnlyList<string> Tags { get; }

        /// <summary>Gets the estimate in minutes.</summary>
        public uint? TimeEstimate { get; }

        /// <summary>Gets the total tracked minutes.</summary>
        public uint TotalTrackedTime { get; }

        /// <summary>Gets whether another task blocks this task.</summary>
        public bool IsBlocked { get; }

        /// <summary>Gets whether this task blocks another task.</summary>
        public bool IsBlocking { get; }

        /// <summary>Gets whether the row's represented task or occurrence is complete.</summary>
        public bool IsCompleted { get; }

        /// <summary>Gets whether the task repeats.</summary>
        public bool IsRecurring { get; }

        /// <summary>Gets whether an unsynchronized command targets the task.</summary>
        public bool IsPending { get; }

        /// <summary>Gets the recurring occurrence represented by the row.</summary>
        public string? OccurrenceDate { get; }

        /// <summary>Gets the presentation group label.</summary>
        public string GroupLabel { get; }

        /// <summary>Gets whether the synchronized task snapshot contains an open time entry.</summary>
        public bool HasActiveTimeSession { get; }

        /// <summary>Gets the compact synchronization label.</summary>
        public string PendingLabel => IsPending ? "Pending" : string.Empty;

        /// <summary>Gets the stable Windows UI Automation identifier.</summary>
        public string AutomationId => AutomationIds.TaskRow(Id);

        /// <summary>Gets a compact date label.</summary>
        // The projected occurrence identifies the row the checkbox acts on, so it has to
        // win: a later recurrence shown with its persisted date would complete a
        // different day from the one the user is reading.
        public string DateLabel => OccurrenceDate ?? Due ?? Scheduled ?? string.Empty;

        /// <summary>Gets a compact taxonomy label.</summary>
        public string TaxonomyLabel => string.Join("  ", Projects.Concat(Contexts).Concat(Tags));
    }

    /// <summary>Editable task fields passed to the core as one partial update.</summary>
    public sealed record TaskEditInput
    {
        /// <summary>Gets the task identifier.</summary>
        public required string Id { get; init; }

        /// <summary>Gets the title.</summary>
        public required string Title { get; init; }

        /// <summary>Gets the Markdown details.</summary>
        public string? Details { get; init; }

        /// <summary>Gets the status wire value.</summary>
        public required string Status { get; init; }

        /// <summary>Gets the priority wire value.</summary>
        public required string Priority { get; init; }

        /// <summary>Gets the due value.</summary>
        public string? Due { get; init; }

        /// <summary>Gets the scheduled value.</summary>
        public string? Scheduled { get; init; }

        /// <summary>Gets the recurrence rule.</summary>
        public string? Recurrence { get; init; }

        /// <summary>Gets the recurrence anchor wire value.</summary>
        public string? RecurrenceAnchor { get; init; }

        /// <summary>Gets the projects.</summary>
        public IReadOnlyList<string> Projects { get; init; } = [];

        /// <summary>Gets the contexts.</summary>
        public IReadOnlyList<string> Contexts { get; init; } = [];

        /// <summary>Gets the tags.</summary>
        public IReadOnlyList<string> Tags { get; init; } = [];

        /// <summary>Gets the estimate in minutes.</summary>
        public uint? TimeEstimate { get; init; }
    }

    /// <summary>The core's natural-language preview plus contextual defaults.</summary>
    public sealed record QuickAddPreview(
        string Title,
        string? Due,
        string Priority,
        IReadOnlyList<string> Projects,
        IReadOnlyList<string> Contexts,
        IReadOnlyList<string> Tags,
        string? Recurrence
    );

    /// <summary>A device-local saved view whose filter and sort documents are core-owned.</summary>
    public sealed record SavedViewDefinition
    {
        /// <summary>Gets the stable view identifier.</summary>
        public required string Id { get; init; }

        /// <summary>Gets the visible name.</summary>
        public required string Name { get; init; }

        /// <summary>Gets the Windows symbol name.</summary>
        public string Symbol { get; init; } = "Filter";

        /// <summary>Gets the semantic tint name.</summary>
        public string Tint { get; init; } = "Accent";

        /// <summary>Gets whether the view is favorited.</summary>
        public bool IsFavorite { get; init; }

        /// <summary>Gets its navigation order.</summary>
        public int Order { get; init; }

        /// <summary>Gets the opaque core filter-chain document.</summary>
        public required string FilterJson { get; init; }

        /// <summary>Gets the opaque core sort document, or no sort.</summary>
        public string? SortJson { get; init; }

        /// <summary>Gets the presentation grouping.</summary>
        public TaskGroupChoice Group { get; init; }
    }

    /// <summary>Tracked-time state for one task.</summary>
    public sealed record TaskTimeReading(string TaskId, uint TotalMinutes, bool HasActiveSession);

    /// <summary>One row in the aggregate time report.</summary>
    public sealed record TimeReportRow(string TaskId, string Title, uint Minutes);

    /// <summary>The aggregate time report returned by the server.</summary>
    public sealed record TimeReportReading(uint TotalMinutes, IReadOnlyList<TimeReportRow> Rows);

    /// <summary>The current server-backed Pomodoro state.</summary>
    public sealed record PomodoroReading(
        bool IsActive,
        string? TaskId,
        uint? SecondsRemaining,
        string? Phase
    );
}
