using System.Globalization;
using System.Text.Json;
using TaskNotes.Protocol;
using ProtocolTask = TaskNotes.Protocol.Task;
using Task = System.Threading.Tasks.Task;

namespace TaskNotes.Windows.Host;

/// <summary>Pure C# store synchronizing Windows presentation state with <c>/api/v1/sync</c> and local SQLite.</summary>
public sealed partial class FacetSyncStore
    : ITaskNotesStore,
        IFacetDetailedCaptureStore,
        IFacetTaskEditorStore,
        IFacetDependencyEditorStore
{
    /// <summary>Board column value representing tasks in a project with no assigned section.</summary>
    public const string NoSectionColumnValue = "no-section";

    private static readonly WorkflowChoice[] DefaultStatusChoices =
    [
        new("open", "Open"),
        new("done", "Completed"),
    ];

    private static readonly WorkflowChoice[] DefaultPriorityChoices =
    [
        new("p1", "Priority 1") { Color = "#D1453B" },
        new("p2", "Priority 2") { Color = "#EB8909" },
        new("p3", "Priority 3") { Color = "#246FE0" },
        new("p4", "Priority 4"),
    ];

    private static readonly string[] DefaultRelationshipTypes =
    [
        "FINISHTOSTART",
        "STARTTOSTART",
        "FINISHTOFINISH",
        "STARTTOFINISH",
    ];

    private readonly FacetSqliteCache _cache;
    private readonly FacetApiClient _apiClient;
    private readonly TimeProvider _time;
    private readonly bool _autoSyncOnMutate;
    private readonly bool _ownsCache;
    private readonly bool _ownsClient;
    private readonly SemaphoreSlim _operations = new(1, 1);
    private readonly List<UndoBatchEntry> _undoStack = [];
    private readonly string _feedbackSessionId = Guid.NewGuid().ToString("N");
    private long _feedbackGeneration;
    private long _publicationSequence;
    private string? _serverUrl;
    private string? _token;
    private TaskNotesSyncState _syncState = TaskNotesSyncState.Unconfigured;
    private string? _userFacingError;
    private TaskListQuery _query = TaskListQuery.Today;
    private FacetCacheSnapshot _snapshot;
    private bool _disposed;

    /// <summary>Initializes a directory-backed sync store opening <c>facet-sync.sqlite3</c>.</summary>
    public FacetSyncStore(
        string directory,
        HttpClient? httpClient = null,
        TimeProvider? timeProvider = null,
        bool autoSyncOnMutate = true
    )
        : this(
            FacetSqliteCache.OpenDirectory(directory),
            httpClient is null
                ? new FacetApiClient()
                : new FacetApiClient(httpClient, ownsClient: false),
            timeProvider,
            autoSyncOnMutate,
            ownsCache: true,
            ownsClient: true
        ) { }

    /// <summary>Initializes a sync store over explicit SQLite cache and HTTP client instances.</summary>
    public FacetSyncStore(
        FacetSqliteCache cache,
        FacetApiClient apiClient,
        TimeProvider? timeProvider = null,
        bool autoSyncOnMutate = true,
        bool ownsCache = true,
        bool ownsClient = true
    )
    {
        ArgumentNullException.ThrowIfNull(cache);
        ArgumentNullException.ThrowIfNull(apiClient);
        _cache = cache;
        _apiClient = apiClient;
        _time = timeProvider ?? TimeProvider.System;
        _autoSyncOnMutate = autoSyncOnMutate;
        _ownsCache = ownsCache;
        _ownsClient = ownsClient;
        _snapshot = _cache.ReadSnapshot();
        State = BuildState(_snapshot, TaskNotesSyncState.Unconfigured, null);
    }

    /// <inheritdoc />
    public event EventHandler? StateChanged;

    /// <summary>Occurs when a local mutation completes so native sound/toast feedback can play.</summary>
    public event Action<FacetAppliedFeedback>? AppliedFeedback;

    /// <summary>Gets or sets the owning window's activation lifetime scene.</summary>
    public FacetFeedbackScene? FeedbackScene { get; set; }

    /// <inheritdoc />
    public TaskNotesState State { get; private set; }

    /// <inheritdoc />
    public string? SelectedProfileId => "default";

    /// <summary>Checks whether an applied feedback event still belongs to this active store session.</summary>
    public bool OwnsFeedback(FacetAppliedFeedback feedback)
    {
        ArgumentNullException.ThrowIfNull(feedback);
        return !_disposed
            && feedback.EngineSessionId == _feedbackSessionId
            && feedback.LifecycleGeneration == Interlocked.Read(ref _feedbackGeneration)
            && feedback.Origin?.IsCurrent != false;
    }

    /// <summary>Checks whether the specified applied outcome sits at the top of the Undo stack.</summary>
    public bool CanUndoOutcome(FacetAppliedFeedback outcome)
    {
        ArgumentNullException.ThrowIfNull(outcome);
        return OwnsFeedback(outcome)
            && _undoStack.Count > 0
            && _undoStack[^1].ReceiptId == outcome.Owner.MutationId;
    }

    /// <summary>Undoes the latest completion outcome when its receipt matches.</summary>
    public Task UndoCurrentSavedAsync(
        string? expectedReceipt = null,
        CancellationToken cancellationToken = default
    )
    {
        if (
            expectedReceipt is not null
            && (_undoStack.Count == 0 || _undoStack[^1].ReceiptId != expectedReceipt)
        )
        {
            throw new FacetValidationException(
                "A newer change owns Undo. Review the task list before continuing."
            );
        }
        return UndoCompletionAsync(cancellationToken);
    }

    /// <inheritdoc />
    public Task InitializeAsync(
        string? serverUrl,
        string? token,
        CancellationToken cancellationToken = default
    ) =>
        RunSerializedAsync(
            async () =>
            {
                string? normalizedUrl = NormalizeServerUrl(serverUrl);
                _token = string.IsNullOrWhiteSpace(token) ? null : token.Trim();
                _snapshot = _cache.ReadSnapshot();

                if (normalizedUrl is null)
                {
                    _serverUrl = null;
                    PublishSnapshot(TaskNotesSyncState.Unconfigured, null);
                    return;
                }

                if (
                    _snapshot.ServerUrl is string previousUrl
                    && !string.Equals(
                        previousUrl,
                        normalizedUrl,
                        StringComparison.OrdinalIgnoreCase
                    )
                )
                {
                    _undoStack.Clear();
                    Interlocked.Increment(ref _feedbackGeneration);
                    _snapshot = _cache.ResetForServer(normalizedUrl);
                }

                _serverUrl = normalizedUrl;
                PublishSnapshot(TaskNotesSyncState.Synchronizing, null);
                await SynchronizeUnlockedAsync(cancellationToken).ConfigureAwait(false);
            },
            cancellationToken
        );

    /// <inheritdoc />
    public Task ReconfigureAsync(
        string? serverUrl,
        string? token,
        CancellationToken cancellationToken = default
    ) => InitializeAsync(serverUrl, token, cancellationToken);

    /// <inheritdoc />
    public Task RefreshAsync(CancellationToken cancellationToken = default) =>
        RunSerializedAsync(
            async () =>
            {
                _snapshot = _cache.ReadSnapshot();
                if (_serverUrl is null)
                {
                    PublishSnapshot(TaskNotesSyncState.Unconfigured, null);
                    return;
                }
                PublishSnapshot(TaskNotesSyncState.Synchronizing, null);
                await SynchronizeUnlockedAsync(cancellationToken).ConfigureAwait(false);
            },
            cancellationToken
        );

    /// <inheritdoc />
    public Task SetQueryAsync(TaskListQuery query, CancellationToken cancellationToken = default) =>
        RunSerializedAsync(
            () =>
            {
                ArgumentNullException.ThrowIfNull(query);
                _query = query;
                PublishSnapshot(_syncState, _userFacingError);
                return Task.CompletedTask;
            },
            cancellationToken
        );

    /// <inheritdoc />
    public Task<DependencyEditorMetadata> ReadDependencyEditorMetadataAsync(
        string profileId,
        CancellationToken cancellationToken = default
    )
    {
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentException.ThrowIfNullOrWhiteSpace(profileId);
        return Task.FromResult(
            new DependencyEditorMetadata(DefaultRelationshipTypes, "FINISHTOSTART")
        );
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        if (_disposed)
            return;
        await _operations.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_disposed)
                return;
            _disposed = true;
            Interlocked.Increment(ref _feedbackGeneration);
            if (_ownsClient)
                _apiClient.Dispose();
            if (_ownsCache)
                _cache.Dispose();
        }
        finally
        {
            _operations.Release();
            _operations.Dispose();
        }
    }

    private async Task SynchronizeUnlockedAsync(CancellationToken cancellationToken)
    {
        if (_serverUrl is null)
        {
            PublishSnapshot(TaskNotesSyncState.Unconfigured, null);
            return;
        }

        IReadOnlyList<QueuedCommand> outbox = _snapshot.Outbox;
        HashSet<string> sentUuids = outbox.Select(c => c.Uuid).ToHashSet(StringComparer.Ordinal);
        SyncRequest request = new(
            SyncToken: _snapshot.SyncToken,
            ResourceTypes: null,
            Commands: outbox
        );

        try
        {
            SyncResponse response = await _apiClient
                .SyncAsync(_serverUrl, _token, request, cancellationToken)
                .ConfigureAwait(false);
            DateTimeOffset syncedAt = _time.GetUtcNow();
            _snapshot = _cache.ApplySyncResponse(response, sentUuids, syncedAt, _serverUrl);
            if (response.TempIdMapping.Count > 0)
                RemapUndoStack(response.TempIdMapping);
            PublishSnapshot(TaskNotesSyncState.Connected, null);
        }
        catch (FacetAuthenticationException auth)
        {
            PublishSnapshot(TaskNotesSyncState.AuthenticationFailure, auth.Message);
        }
        catch (FacetNetworkException network)
        {
            PublishSnapshot(TaskNotesSyncState.CachedOffline, network.Message);
        }
        catch (FacetApiException api)
        {
            PublishSnapshot(
                TaskNotesSyncState.SynchronizationError,
                $"{api.Message} (HTTP {api.StatusCode})"
            );
        }
    }

    private async Task SyncAfterLocalMutationUnlockedAsync(CancellationToken cancellationToken)
    {
        if (!_autoSyncOnMutate || _serverUrl is null)
        {
            TaskNotesSyncState offlineState = _serverUrl is null
                ? TaskNotesSyncState.Unconfigured
                : TaskNotesSyncState.CachedOffline;
            PublishSnapshot(
                _syncState == TaskNotesSyncState.Connected
                    ? TaskNotesSyncState.Connected
                    : offlineState,
                _userFacingError
            );
            return;
        }

        PublishSnapshot(_syncState, _userFacingError);
        await SynchronizeUnlockedAsync(cancellationToken).ConfigureAwait(false);
    }

    private void PublishSnapshot(TaskNotesSyncState syncState, string? error)
    {
        _syncState = syncState;
        _userFacingError = error;
        State = BuildState(_snapshot, syncState, error);
        StateChanged?.Invoke(this, EventArgs.Empty);
    }

    private TaskNotesState BuildState(
        FacetCacheSnapshot snapshot,
        TaskNotesSyncState syncState,
        string? error
    )
    {
        DateOnly today = CurrentLocalDate();
        HashSet<string> pendingIds = CollectPendingTaskIds(snapshot.Outbox);

        Dictionary<string, Project> projectsById = snapshot
            .Projects.Where(p => !p.IsDeleted && !p.IsArchived)
            .ToDictionary(p => p.Id, StringComparer.Ordinal);
        string? inboxProjectId = snapshot
            .Projects.FirstOrDefault(p => !p.IsDeleted && p.IsInbox)
            ?.Id;
        Dictionary<string, Label> labelsById = snapshot
            .Labels.Where(l => !l.IsDeleted)
            .ToDictionary(l => l.Id, StringComparer.Ordinal);
        ILookup<string, Reminder> remindersByTask = snapshot
            .Reminders.Where(r => !r.IsDeleted)
            .ToLookup(r => r.TaskId, StringComparer.Ordinal);

        List<TaskItem> allTasks = snapshot
            .Tasks.Where(t => !t.IsDeleted)
            .OrderBy(t => t.ChildOrder)
            .ThenBy(t => t.CreatedAt, StringComparer.Ordinal)
            .Select(task =>
                MapTaskItem(
                    task,
                    projectsById,
                    inboxProjectId,
                    labelsById,
                    remindersByTask[task.Id],
                    pendingIds.Contains(task.Id),
                    _query,
                    today
                )
            )
            .ToList();

        List<TodayTask> todayTasks = allTasks
            .Where(task => !task.IsCompleted && IsAdmittedToToday(task, today))
            .Select(task => new TodayTask(
                task.Id,
                task.Title,
                task.Due,
                task.Scheduled,
                task.IsCompleted,
                task.IsRecurring,
                task.IsPending
            ))
            .ToList();

        IReadOnlyList<SavedViewDefinition> savedViews = snapshot
            .Filters.Where(f => !f.IsDeleted)
            .OrderBy(f => f.ItemOrder)
            .ThenBy(f => f.Name, StringComparer.OrdinalIgnoreCase)
            .Select((filter, index) => MapSavedView(filter, index))
            .ToArray();

        TaskListQuery effectiveQuery = ResolveEffectiveQuery(_query, savedViews);
        IReadOnlyList<TaskItem> visibleTasks = FilterAndSortTasks(
            allTasks,
            effectiveQuery,
            inboxProjectId,
            today
        );

        string[] projectNames = snapshot
            .Projects.Where(p => !p.IsDeleted && !p.IsArchived && !p.IsInbox)
            .OrderBy(p => p.ChildOrder)
            .ThenBy(p => p.Name, StringComparer.OrdinalIgnoreCase)
            .Select(p => p.Name)
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        string[] tagNames = snapshot
            .Labels.Where(l => !l.IsDeleted)
            .OrderBy(l => l.ItemOrder)
            .ThenBy(l => l.Name, StringComparer.OrdinalIgnoreCase)
            .Select(l => l.Name)
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        IReadOnlyList<FacetBoardColumnSnapshot> boardColumns = BuildBoardColumns(
            allTasks,
            snapshot.Projects,
            snapshot.Sections,
            effectiveQuery
        );

        IReadOnlyList<FacetScheduledReminder> scheduledReminders = BuildScheduledReminders(
            snapshot.Tasks,
            snapshot.Reminders
        );

        return new TaskNotesState(
            todayTasks: todayTasks,
            pendingIds: pendingIds,
            pendingCount: checked((uint)snapshot.Outbox.Count),
            parkedChanges: snapshot.ParkedMutations.Select(p => p.ToParkedChange()).ToArray(),
            syncState: syncState,
            userFacingError: error,
            lastSyncTime: snapshot.LastSyncTime
        )
        {
            PublicationSequence = Interlocked.Increment(ref _publicationSequence),
            AllTasks = allTasks,
            VisibleTasks = visibleTasks,
            Query = _query,
            Projects = projectNames,
            Contexts = [],
            Tags = tagNames,
            StatusChoices = DefaultStatusChoices,
            PriorityChoices = DefaultPriorityChoices,
            BoardColumns = boardColumns,
            ScheduledReminders = scheduledReminders,
            SavedViews = savedViews,
            CanUndoCompletion = _undoStack.Count > 0,
            CompletionUndoDepth = _undoStack.Count,
        };
    }

    private static TaskItem MapTaskItem(
        ProtocolTask task,
        Dictionary<string, Project> projectsById,
        string? inboxProjectId,
        Dictionary<string, Label> labelsById,
        IEnumerable<Reminder> reminders,
        bool isPending,
        TaskListQuery query,
        DateOnly today
    )
    {
        string priorityWire = QuickCaptureParser.ToPriorityWire(task.Priority);
        WorkflowChoice priorityChoice = DefaultPriorityChoices.FirstOrDefault(c =>
            c.Value == priorityWire
        ) ?? DefaultPriorityChoices[3];
        string statusWire = task.Completed ? "done" : "open";
        string statusLabel = task.Completed ? "Completed" : "Open";

        IReadOnlyList<string> projectNames = [];
        if (
            !string.IsNullOrEmpty(task.ProjectId)
            && task.ProjectId != inboxProjectId
            && projectsById.TryGetValue(task.ProjectId, out Project? project)
            && !project.IsInbox
        )
        {
            projectNames = [project.Name];
        }

        string[] tagNames = task
            .LabelIds.Select(id => labelsById.TryGetValue(id, out Label? label) ? label.Name : null)
            .Where(name => !string.IsNullOrEmpty(name))
            .Select(name => name!)
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        string? effectiveDue = task.DueDate ?? ExtractDatePrefix(task.DueDatetime);
        string groupLabel = ComputeGroupLabel(
            query.Group,
            statusWire,
            priorityWire,
            projectNames,
            effectiveDue,
            today
        );

        object[] reminderDocs = reminders
            .Select(rem =>
                string.Equals(rem.ReminderType, "absolute", StringComparison.OrdinalIgnoreCase)
                    ? (object)
                        new
                        {
                            id = rem.Id,
                            type = "absolute",
                            absoluteTime = rem.DueDatetime ?? string.Empty,
                        }
                    : new
                    {
                        id = rem.Id,
                        type = "relative",
                        relatedTo = "due",
                        offset = FormatMinuteOffsetIso(rem.MinuteOffset ?? -15),
                    }
            )
            .ToArray();

        JsonElement properties = JsonSerializer.SerializeToElement(
            new
            {
                dateCreated = task.CreatedAt,
                completedDate = ExtractDatePrefix(task.CompletedAt),
                reminders = reminderDocs,
            }
        );

        return new TaskItem(
            id: task.Id,
            title: task.Title,
            details: string.IsNullOrEmpty(task.Description) ? null : task.Description,
            status: statusWire,
            statusLabel: statusLabel,
            priority: priorityWire,
            priorityLabel: priorityChoice.Label,
            due: effectiveDue,
            scheduled: null,
            recurrence: task.RecurrenceRule,
            recurrenceAnchor: effectiveDue,
            projects: projectNames,
            contexts: [],
            tags: tagNames,
            isBlocked: false,
            isBlocking: false,
            isCompleted: task.Completed,
            isRecurring: task.IsRecurring,
            isPending: isPending,
            occurrenceDate: null,
            groupLabel: groupLabel
        )
        {
            ProfileId = "default",
            VaultPath = task.Id,
            ExpectedRevision = task.UpdatedAt,
            EffectiveDate = effectiveDue,
            HasCoreEffectiveDate = true,
            PriorityColor = priorityChoice.Color,
            Properties = properties,
            ProjectId = task.ProjectId,
            SectionId = task.SectionId,
            ParentId = task.ParentId,
            ChildOrder = task.ChildOrder,
        };
    }

    private static IReadOnlyList<FacetBoardColumnSnapshot> BuildBoardColumns(
        IReadOnlyList<TaskItem> allTasks,
        IReadOnlyList<Project> projects,
        IReadOnlyList<Section> sections,
        TaskListQuery query
    )
    {
        Project? scopedProject = null;
        if (query.Kind == TaskListKind.Project && !string.IsNullOrWhiteSpace(query.Scope))
        {
            scopedProject = projects.FirstOrDefault(p =>
                !p.IsDeleted
                && (
                    string.Equals(p.Name, query.Scope, StringComparison.OrdinalIgnoreCase)
                    || string.Equals(p.Id, query.Scope, StringComparison.Ordinal)
                )
            );
        }

        if (scopedProject is not null)
        {
            TaskItem[] projectTasks = allTasks
                .Where(t => !t.IsCompleted && t.ProjectId == scopedProject.Id)
                .OrderBy(t => t.ChildOrder)
                .ToArray();
            Section[] projectSections = sections
                .Where(s => !s.IsDeleted && !s.IsArchived && s.ProjectId == scopedProject.Id)
                .OrderBy(s => s.SectionOrder)
                .ToArray();
            HashSet<string> sectionIds = projectSections
                .Select(s => s.Id)
                .ToHashSet(StringComparer.Ordinal);

            List<FacetBoardColumnSnapshot> columns =
            [
                new(
                    NoSectionColumnValue,
                    "No section",
                    projectTasks
                        .Where(t =>
                            string.IsNullOrEmpty(t.SectionId) || !sectionIds.Contains(t.SectionId)
                        )
                        .ToArray(),
                    IsSectionColumn: true
                ),
            ];
            foreach (Section section in projectSections)
            {
                columns.Add(
                    new FacetBoardColumnSnapshot(
                        section.Id,
                        section.Name,
                        projectTasks.Where(t => t.SectionId == section.Id).ToArray(),
                        IsSectionColumn: true
                    )
                );
            }
            return columns;
        }

        return DefaultPriorityChoices
            .Select(choice => new FacetBoardColumnSnapshot(
                choice.Value,
                choice.Label,
                allTasks
                    .Where(t => !t.IsCompleted && t.Priority == choice.Value)
                    .OrderBy(t => t.ChildOrder)
                    .ToArray(),
                IsSectionColumn: false
            ))
            .ToArray();
    }

    private static FacetScheduledReminder[] BuildScheduledReminders(
        IReadOnlyList<ProtocolTask> tasks,
        IReadOnlyList<Reminder> reminders
    )
    {
        Dictionary<string, ProtocolTask> activeTasks = tasks
            .Where(t => !t.IsDeleted && !t.Completed)
            .ToDictionary(t => t.Id, StringComparer.Ordinal);
        List<FacetScheduledReminder> scheduled = [];

        foreach (Reminder reminder in reminders)
        {
            if (reminder.IsDeleted || reminder.IsNotified)
                continue;
            if (!activeTasks.TryGetValue(reminder.TaskId, out ProtocolTask? task))
                continue;

            DateTimeOffset? fireAt = null;
            if (
                string.Equals(reminder.ReminderType, "absolute", StringComparison.OrdinalIgnoreCase)
                && !string.IsNullOrWhiteSpace(reminder.DueDatetime)
                && DateTimeOffset.TryParse(
                    reminder.DueDatetime,
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.RoundtripKind,
                    out DateTimeOffset absTime
                )
            )
            {
                fireAt = absTime;
            }
            else if (
                string.Equals(reminder.ReminderType, "relative", StringComparison.OrdinalIgnoreCase)
            )
            {
                DateTimeOffset? anchor = null;
                if (
                    !string.IsNullOrWhiteSpace(task.DueDatetime)
                    && DateTimeOffset.TryParse(
                        task.DueDatetime,
                        CultureInfo.InvariantCulture,
                        DateTimeStyles.RoundtripKind,
                        out DateTimeOffset dueDt
                    )
                )
                {
                    anchor = dueDt;
                }
                else if (RecurrenceCodec.TryParseCivilDate(task.DueDate, out DateOnly dueCivil))
                {
                    anchor = new DateTimeOffset(
                        dueCivil.ToDateTime(new TimeOnly(9, 0)),
                        TimeZoneInfo.Local.GetUtcOffset(dueCivil.ToDateTime(new TimeOnly(9, 0)))
                    );
                }

                if (anchor is DateTimeOffset resolvedAnchor)
                    fireAt = resolvedAnchor.AddMinutes(reminder.MinuteOffset ?? -15);
            }

            if (fireAt is DateTimeOffset whenToFire)
            {
                scheduled.Add(
                    new FacetScheduledReminder(
                        NotificationId: $"facet-rem-{reminder.Id}",
                        TaskId: task.Id,
                        Title: task.Title,
                        ReminderId: reminder.Id,
                        FireAt: whenToFire,
                        Description: string.IsNullOrWhiteSpace(task.Description)
                            ? null
                            : task.Description
                    )
                );
            }
        }

        return scheduled.OrderBy(r => r.FireAt).ToArray();
    }

    private static TaskItem[] FilterAndSortTasks(
        List<TaskItem> allTasks,
        TaskListQuery query,
        string? inboxProjectId,
        DateOnly today
    )
    {
        IEnumerable<TaskItem> filtered = query.Kind switch
        {
            TaskListKind.Inbox => allTasks.Where(t =>
                !t.IsCompleted
                && (
                    t.Projects.Count == 0
                    || string.IsNullOrEmpty(t.ProjectId)
                    || t.ProjectId == inboxProjectId
                )
            ),
            TaskListKind.Today => allTasks.Where(t =>
                !t.IsCompleted && IsAdmittedToToday(t, today)
            ),
            TaskListKind.Upcoming => allTasks.Where(t =>
                !t.IsCompleted
                && RecurrenceCodec.TryParseCivilDate(t.Due, out DateOnly due)
                && due > today
            ),
            TaskListKind.Completed => allTasks.Where(t => t.IsCompleted),
            TaskListKind.Project => allTasks.Where(t =>
                !t.IsCompleted
                && query.Scope is not null
                && (
                    t.Projects.Any(p =>
                        string.Equals(p, query.Scope, StringComparison.OrdinalIgnoreCase)
                    ) || string.Equals(t.ProjectId, query.Scope, StringComparison.Ordinal)
                )
            ),
            TaskListKind.Tag => allTasks.Where(t =>
                !t.IsCompleted
                && query.Scope is not null
                && t.Tags.Any(tag =>
                    string.Equals(tag, query.Scope, StringComparison.OrdinalIgnoreCase)
                )
            ),
            TaskListKind.Context => allTasks.Where(t =>
                !t.IsCompleted
                && query.Scope is not null
                && (
                    t.Contexts.Any(ctx =>
                        string.Equals(ctx, query.Scope, StringComparison.OrdinalIgnoreCase)
                    )
                    || t.Tags.Any(tag =>
                        string.Equals(tag, query.Scope, StringComparison.OrdinalIgnoreCase)
                    )
                )
            ),
            TaskListKind.Board => allTasks.Where(t => !t.IsCompleted),
            _ => allTasks.Where(t =>
                !t.IsCompleted || query.Statuses.Contains("done", StringComparer.OrdinalIgnoreCase)
            ),
        };

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            string needle = query.Search.Trim();
            filtered = filtered.Where(t =>
                t.Title.Contains(needle, StringComparison.OrdinalIgnoreCase)
                || (t.Details?.Contains(needle, StringComparison.OrdinalIgnoreCase) == true)
                || t.Projects.Any(p => p.Contains(needle, StringComparison.OrdinalIgnoreCase))
                || t.Tags.Any(tag => tag.Contains(needle, StringComparison.OrdinalIgnoreCase))
            );
        }

        if (query.Statuses.Count > 0)
        {
            filtered = filtered.Where(t =>
                query.Statuses.Contains(t.Status, StringComparer.OrdinalIgnoreCase)
            );
        }

        if (query.Priorities.Count > 0)
        {
            filtered = filtered.Where(t =>
                query.Priorities.Contains(t.Priority, StringComparer.OrdinalIgnoreCase)
            );
        }

        if (query.Projects.Count > 0)
        {
            filtered = filtered.Where(t =>
                t.Projects.Any(p => query.Projects.Contains(p, StringComparer.OrdinalIgnoreCase))
            );
        }

        if (query.Tags.Count > 0)
        {
            filtered = filtered.Where(t =>
                t.Tags.Any(tag => query.Tags.Contains(tag, StringComparer.OrdinalIgnoreCase))
            );
        }

        if (query.Contexts.Count > 0)
        {
            filtered = filtered.Where(t =>
                t.Contexts.Any(ctx =>
                    query.Contexts.Contains(ctx, StringComparer.OrdinalIgnoreCase)
                )
            );
        }

        if (query.HasNoDueDate)
        {
            filtered = filtered.Where(t => string.IsNullOrEmpty(t.Due));
        }

        IEnumerable<TaskItem> sorted = query.Sort switch
        {
            TaskSortChoice.DueDate or TaskSortChoice.EffectiveDate => query.Descending
                ? filtered
                    .OrderByDescending(t => t.Due is not null)
                    .ThenByDescending(t => t.Due, StringComparer.Ordinal)
                    .ThenBy(t => t.ChildOrder)
                : filtered
                    .OrderBy(t => t.Due is null)
                    .ThenBy(t => t.Due, StringComparer.Ordinal)
                    .ThenBy(t => t.ChildOrder),
            TaskSortChoice.Priority => query.Descending
                ? filtered
                    .OrderByDescending(t => PriorityRank(t.Priority))
                    .ThenBy(t => t.ChildOrder)
                : filtered.OrderBy(t => PriorityRank(t.Priority)).ThenBy(t => t.ChildOrder),
            TaskSortChoice.Title => query.Descending
                ? filtered.OrderByDescending(t => t.Title, StringComparer.OrdinalIgnoreCase)
                : filtered.OrderBy(t => t.Title, StringComparer.OrdinalIgnoreCase),
            _ => query.Descending ? filtered.Reverse() : filtered,
        };

        return sorted
            .Select(task =>
            {
                string label = ComputeGroupLabel(
                    query.Group,
                    task.Status,
                    task.Priority,
                    task.Projects,
                    task.Due,
                    today
                );
                return label == task.GroupLabel ? task : MakeTaskWithGroup(task, label);
            })
            .ToArray();
    }

    private static TaskItem MakeTaskWithGroup(TaskItem source, string groupLabel) =>
        new(
            source.Id,
            source.Title,
            source.Details,
            source.Status,
            source.StatusLabel,
            source.Priority,
            source.PriorityLabel,
            source.Due,
            source.Scheduled,
            source.Recurrence,
            source.RecurrenceAnchor,
            source.Projects,
            source.Contexts,
            source.Tags,
            source.IsBlocked,
            source.IsBlocking,
            source.IsCompleted,
            source.IsRecurring,
            source.IsPending,
            source.OccurrenceDate,
            groupLabel
        )
        {
            ProfileId = source.ProfileId,
            VaultPath = source.VaultPath,
            ExpectedRevision = source.ExpectedRevision,
            EffectiveDate = source.EffectiveDate,
            HasCoreEffectiveDate = source.HasCoreEffectiveDate,
            StatusColor = source.StatusColor,
            PriorityColor = source.PriorityColor,
            Properties = source.Properties,
            ProjectId = source.ProjectId,
            SectionId = source.SectionId,
            ParentId = source.ParentId,
            ChildOrder = source.ChildOrder,
        };

    private static bool IsAdmittedToToday(TaskItem task, DateOnly today)
    {
        if (RecurrenceCodec.TryParseCivilDate(task.Due, out DateOnly due) && due <= today)
            return true;
        if (task.IsRecurring && !string.IsNullOrWhiteSpace(task.Recurrence))
            return RecurrenceCodec.OccursOn(task.Recurrence, task.Due, today);
        return false;
    }

    private static string ComputeGroupLabel(
        TaskGroupChoice group,
        string status,
        string priority,
        IReadOnlyList<string> projects,
        string? due,
        DateOnly today
    ) =>
        group switch
        {
            TaskGroupChoice.Status => status,
            TaskGroupChoice.Priority => priority,
            TaskGroupChoice.Project => projects.Count > 0 ? projects[0] : "Inbox",
            TaskGroupChoice.Date => ClassifyDateBucket(due, today),
            _ => string.Empty,
        };

    private static string ClassifyDateBucket(string? due, DateOnly today)
    {
        if (!RecurrenceCodec.TryParseCivilDate(due, out DateOnly date))
            return "No date";
        if (date < today)
            return "Overdue";
        if (date == today)
            return "Today";
        if (date == today.AddDays(1))
            return "Tomorrow";
        return "Upcoming";
    }

    private static int PriorityRank(string priority) =>
        priority switch
        {
            "p1" => 1,
            "p2" => 2,
            "p3" => 3,
            _ => 4,
        };

    private static HashSet<string> CollectPendingTaskIds(IReadOnlyList<QueuedCommand> outbox)
    {
        HashSet<string> ids = new(StringComparer.Ordinal);
        foreach (QueuedCommand item in outbox)
        {
            switch (item.Command)
            {
                case SyncCommand.TaskAdd:
                    ids.Add(item.TempId ?? item.Uuid);
                    break;
                case SyncCommand.TaskUpdate { Args.Id: var id }:
                    ids.Add(id);
                    break;
                case SyncCommand.TaskComplete { Args.Id: var id }:
                    ids.Add(id);
                    break;
                case SyncCommand.TaskUncomplete { Args.Id: var id }:
                    ids.Add(id);
                    break;
                case SyncCommand.TaskReorder { Args.Id: var id }:
                    ids.Add(id);
                    break;
                case SyncCommand.TaskDelete { Args.Id: var id }:
                    ids.Add(id);
                    break;
                case SyncCommand.ReminderAdd { Args.TaskId: var taskId }:
                    ids.Add(taskId);
                    break;
            }
        }
        return ids;
    }

    private DateOnly CurrentLocalDate() =>
        DateOnly.FromDateTime(
            TimeZoneInfo.ConvertTime(_time.GetUtcNow(), _time.LocalTimeZone).DateTime
        );

    private static string? NormalizeServerUrl(string? serverUrl)
    {
        if (string.IsNullOrWhiteSpace(serverUrl))
            return null;
        string trimmed = serverUrl.Trim();
        if (
            !Uri.TryCreate(trimmed, UriKind.Absolute, out Uri? uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
        )
        {
            throw new FacetValidationException("Enter an absolute HTTP or HTTPS Facet server URL.");
        }
        return trimmed.TrimEnd('/');
    }

    private static string? ExtractDatePrefix(string? value) =>
        !string.IsNullOrWhiteSpace(value) && value.Length >= 10 ? value[..10] : null;

    private static string FormatMinuteOffsetIso(int minuteOffset)
    {
        int abs = Math.Abs(minuteOffset);
        string prefix = minuteOffset < 0 ? "-PT" : "PT";
        return $"{prefix}{abs.ToString(CultureInfo.InvariantCulture)}M";
    }

    private async Task RunSerializedAsync(Func<Task> operation, CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        await _operations.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            await operation().ConfigureAwait(false);
        }
        finally
        {
            _operations.Release();
        }
    }

    private async Task<T> RunSerializedAsync<T>(
        Func<Task<T>> operation,
        CancellationToken cancellationToken
    )
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        await _operations.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            return await operation().ConfigureAwait(false);
        }
        finally
        {
            _operations.Release();
        }
    }
}
