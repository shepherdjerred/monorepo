using System.Globalization;
using System.Runtime.ExceptionServices;
using System.Text.Json;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Host;

/// <summary>Standalone bounded tracking pages retain their original request owners.</summary>
public interface IFacetTrackingStore
{
    /// <summary>Load a fresh running-session page or its original owner's next page.</summary>
    Task LoadTrackingSessionsAsync(
        bool nextPage = false,
        CancellationToken cancellationToken = default
    );

    /// <summary>Continue the displayed task history without changing its original clock or vault.</summary>
    Task LoadNextTrackingHistoryAsync(CancellationToken cancellationToken = default);
}

/// <summary>A standalone edit returns the projection identified by its durable applied receipt.</summary>
public interface IFacetTaskEditorStore
{
    /// <summary>Apply one frozen edit and return its authoritative resulting path/revision projection.</summary>
    Task<TaskItem> SaveTaskEditAsync(
        TaskEditInput input,
        CancellationToken cancellationToken = default
    );
}

/// <summary>Standalone store consumed by every Windows presentation surface.</summary>
public sealed class FacetTaskNotesStore
    : ITaskNotesStore,
        IFacetProfileStore,
        IFacetTaskEditorStore,
        IFacetTrackingStore
{
    private readonly string _directory;
    private readonly FacetProfileCatalog _catalog;
    private readonly FacetMutationJournal _journal;
    private readonly FacetEngineService _engine;
    private readonly TimeProvider _time;
    private readonly bool _allowSync;
    private readonly ObsidianAccountService _account;
    private readonly Func<IFacetSocket>? _socketFactory;
    private readonly SemaphoreSlim _operations = new(1, 1);
    private readonly Dictionary<string, FacetSyncSession> _sessions = new(StringComparer.Ordinal);
    private readonly CoalescingTaskPump _updates;
    private readonly Dictionary<string, (bool Connected, string? Error)> _connection = new(
        StringComparer.Ordinal
    );
    private readonly Dictionary<string, JsonElement> _tasks = new(StringComparer.Ordinal);
    private readonly Dictionary<string, JsonElement> _views = new(StringComparer.Ordinal);
    private bool _disposed;
    private long _sessionGeneration;
    private readonly System.Collections.Concurrent.ConcurrentDictionary<
        string,
        FacetSyncSession
    > _retainedSessions = new(StringComparer.Ordinal);
    private readonly object _disposeGate = new();
    private readonly TaskCompletionSource<bool> _operationsDrained = new(
        TaskCreationOptions.RunContinuationsAsynchronously
    );
    private int _activeOperations;
    private Task? _disposeTask;
    private string? _undoReceiptId;
    private readonly FacetSchema _receiptSchema = FacetSchema.Bundled();
    private FacetNoticeOwner? _noticeOwner;
    private FacetSavedNotice? _savedNotice;
    private string? _savedMaintenance;
    private readonly FacetNoticeAuthority _noticeAuthority = new();
    private FacetNoticeAdmission? _operationNoticeAdmission;
    private FacetNoticeOwner? _updateNoticeOwner;
    private long _trackingRequestGeneration;
    private long _trackingEngineGeneration = 1;
    private FacetTrackingOwner? _historyOwner;
    private FacetTrackingOwner? _sessionsOwner;
    private string? _indexedProfileId;

    private bool OwnsNotice(FacetNoticeOwner owner) =>
        !_disposed && owner == _noticeOwner && _noticeAuthority.Owns(owner, SelectedProfileId);

    private void ClearNoticePresentation()
    {
        _noticeOwner = null;
        _savedNotice = null;
        _savedMaintenance = null;
        State = State with { SavedNotice = null, SavedNoticeOwner = null, SavedMaintenance = null };
    }

    private FacetNoticeAdmission BeginNoticeRequest()
    {
        bool hadNotice = false;
        var admission = _noticeAuthority.Begin(() =>
        {
            hadNotice = State.SavedNoticeOwner is not null || State.SavedMaintenance is not null;
            ClearNoticePresentation();
        });
        if (hadNotice)
            Notify();
        return admission;
    }

    private void InvalidateTracking()
    {
        _trackingRequestGeneration++;
        _trackingEngineGeneration++;
        _historyOwner = null;
        _sessionsOwner = null;
        _indexedProfileId = null;
        State = State with
        {
            TrackingHistory = null,
            TrackingSessions = null,
            TaskTime = null,
            FacetIndexVersion = null,
        };
    }

    /// <summary>Restore local capability metadata and secure account ownership.</summary>
    public FacetTaskNotesStore(string directory, IFacetSecretStore secrets)
        : this(directory, secrets, null, null) { }

    /// <summary>A reminder-only background writer does not start network sessions.</summary>
    public FacetTaskNotesStore(string directory, IFacetSecretStore secrets, bool synchronize)
        : this(directory, secrets, null, null, allowSync: synchronize) { }

    internal FacetTaskNotesStore(
        string directory,
        IFacetSecretStore secrets,
        HttpClient? accountHttp,
        Func<IFacetSocket>? socketFactory,
        TimeProvider? time = null,
        bool allowSync = true,
        Func<FacetVaultFiles, string, string, string, FacetBoundedVault>? capabilityFactory = null
    )
    {
        _directory = directory;
        _time = time ?? TimeProvider.System;
        _allowSync = allowSync;
        _catalog = new FacetProfileCatalog(directory);
        _journal = new FacetMutationJournal(directory);
        _engine = new FacetEngineService(
            Path.Combine(directory, "facet.sqlite"),
            _catalog.Profiles.Select(p => new FacetFolderCapability(
                p.Id,
                p.RootPath,
                p.PrivateReplica
            )),
            capabilityFactory
        );
        _account = accountHttp is null
            ? new ObsidianAccountService(secrets)
            : new ObsidianAccountService(secrets, accountHttp);
        _socketFactory = socketFactory;
        _updates = new CoalescingTaskPump(PublishUpdateAsync);
    }

    /// <inheritdoc/>
    public event EventHandler? StateChanged;

    /// <inheritdoc/>
    public TaskNotesState State { get; private set; } = TaskNotesState.Unconfigured;

    /// <inheritdoc/>
    public IReadOnlyList<FacetProfileRegistration> Profiles => _catalog.Profiles;

    /// <inheritdoc/>
    public string? SelectedProfileId => _catalog.SelectedId;

    /// <summary>Read every fenced reminder page and retain writer ownership until native schedule effects finish.</summary>
    public Task ReconcileReminderPlanAsync(
        string profileId,
        DateTimeOffset at,
        string timezone,
        DateTimeOffset to,
        Func<FacetReminderPlan, CancellationToken, Task> apply,
        CancellationToken cancellationToken = default
    ) =>
        SerializedAsync(
            async () =>
            {
                ArgumentNullException.ThrowIfNull(apply);
                var profile = Profiles.Single(p => p.Id == profileId);
                if (profile.PrivateReplica)
                {
                    if (profile.AccountOwner is null || profile.Vault is null)
                        throw new FacetAuthorizationRequiredException(
                            "Authorize this vault before scheduling its reminders."
                        );
                    _ = _account.SessionCredentials(
                        profile.AccountOwner,
                        profile.Id,
                        profile.Vault.Id
                    );
                }
                FacetReminderPlan plan;
                try
                {
                    plan = await FacetReminderPlanReader
                        .ReadAsync(
                            profileId,
                            at,
                            timezone,
                            at,
                            to,
                            (request, token) => _engine.FeaturesAsync(profileId, request, token),
                            cancellationToken
                        )
                        .ConfigureAwait(false);
                }
                catch (Exception error)
                    when (error
                            is Core.FacetEngineException.Configuration
                                or Core.FacetEngineException.Host
                                or Core.FacetHostException
                    )
                {
                    throw new FacetReminderUnavailableException(
                        "Restore vault access and TaskNotes configuration before updating its reminder schedule.",
                        error
                    );
                }
                await apply(plan, cancellationToken).ConfigureAwait(false);
            },
            cancellationToken
        );

    private string Selected =>
        SelectedProfileId ?? throw new InvalidOperationException("Set up a vault first.");

    /// <inheritdoc/>
    public Task InitializeAsync(
        string? serverUrl,
        string? token,
        CancellationToken cancellationToken = default
    )
    {
        if (serverUrl is not null || token is not null)
            throw new ArgumentException(
                "Facet uses vault capabilities and Obsidian Sync account authorization."
            );
        return SerializedAsync(
            async () =>
            {
                await _engine.InitializeAsync(cancellationToken).ConfigureAwait(false);
                await RecoverProfileRemovalsAsync(cancellationToken).ConfigureAwait(false);
                foreach (var profile in Profiles)
                {
                    try
                    {
                        await _engine
                            .RegisterProfileAsync(
                                profile.Id,
                                profile.Name,
                                profile.RootPath,
                                profile.PrivateReplica,
                                profile.ApproveStandard,
                                cancellationToken
                            )
                            .ConfigureAwait(false);
                        await _engine
                            .RefreshAsync(profile.Id, cancellationToken)
                            .ConfigureAwait(false);
                    }
                    catch (Exception error)
                        when (error
                                is Core.FacetHostException
                                    or Core.FacetEngineException.Host
                                    or Core.FacetEngineException.Configuration
                        )
                    {
                        lock (_connection)
                            _connection[profile.Id] = (
                                false,
                                error is Core.FacetEngineException.Configuration configuration
                                    ? configuration.detail
                                    : "Restore access to this vault folder, then refresh. The last complete indexed snapshot remains available."
                            );
                    }
                }
                await StartSessionsAsync(cancellationToken).ConfigureAwait(false);
                await PublishAsync().ConfigureAwait(false);
            },
            cancellationToken
        );
    }

    /// <inheritdoc/>
    public Task ReconfigureAsync(
        string? serverUrl,
        string? token,
        CancellationToken cancellationToken = default
    ) => InitializeAsync(serverUrl, token, cancellationToken);

    /// <inheritdoc/>
    public Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        _ = BeginNoticeRequest();
        InvalidateTracking();
        return SerializedAsync(
            async () =>
            {
                if (SelectedProfileId is null)
                    return;
                await StartSessionsAsync(cancellationToken).ConfigureAwait(false);
                try
                {
                    await _engine.RefreshAsync(Selected, cancellationToken).ConfigureAwait(false);
                }
                catch (Core.FacetEngineException.Configuration error)
                {
                    lock (_connection)
                        _connection[Selected] = (false, error.detail);
                }
                foreach (var session in _sessions.Values)
                    await session.WakeAsync(cancellationToken).ConfigureAwait(false);
                await PublishAsync().ConfigureAwait(false);
            },
            cancellationToken
        );
    }

    /// <inheritdoc/>
    public Task SetQueryAsync(TaskListQuery query, CancellationToken cancellationToken = default)
    {
        _ = BeginNoticeRequest();
        InvalidateTracking();
        return SerializedAsync(
            async () =>
            {
                ArgumentNullException.ThrowIfNull(query);
                State = State with { Query = query };
                await PublishAsync().ConfigureAwait(false);
            },
            cancellationToken
        );
    }

    /// <inheritdoc/>
    public Task<QuickAddPreview> PreviewQuickAddAsync(
        string input,
        CancellationToken cancellationToken = default
    ) =>
        SerializedAsync(
            async () =>
            {
                JsonElement preview = await FeatureAsync(
                        new
                        {
                            schemaVersion = 1,
                            kind = "capture_preview",
                            input,
                            at = Timestamp(),
                            today = Today(),
                        },
                        cancellationToken
                    )
                    .ConfigureAwait(false);
                var properties = preview.GetProperty("properties");
                return new QuickAddPreview(
                    Text(properties, "title") ?? "",
                    Text(properties, "due"),
                    Text(properties, "priority") ?? "",
                    Strings(properties, "projects"),
                    Strings(properties, "contexts"),
                    Strings(properties, "tags"),
                    Text(properties, "recurrence")
                );
            },
            cancellationToken
        );

    /// <inheritdoc/>
    public Task AddAsync(
        string input,
        TaskListQuery context,
        CancellationToken cancellationToken = default
    ) =>
        SerializedAsync(
            async () =>
            {
                JsonElement preview = await FeatureAsync(
                        new
                        {
                            schemaVersion = 1,
                            kind = "capture_preview",
                            input,
                            at = Timestamp(),
                            today = Today(),
                            context = new
                            {
                                projects = context.Kind == TaskListKind.Project
                                && context.Scope is not null
                                    ? new[] { context.Scope }
                                    : null,
                                contexts = context.Kind == TaskListKind.Context
                                && context.Scope is not null
                                    ? new[] { context.Scope }
                                    : null,
                                tags = context.Kind == TaskListKind.Tag && context.Scope is not null
                                    ? new[] { context.Scope }
                                    : null,
                                scheduled = context.Kind == TaskListKind.Today ? Today() : null,
                            },
                        },
                        cancellationToken
                    )
                    .ConfigureAwait(false);
                var properties = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(
                    preview.GetProperty("properties").GetRawText()
                )!;
                await MutateAsync(
                        new
                        {
                            kind = "create",
                            properties,
                            body = preview.GetProperty("body").GetString(),
                        },
                        false,
                        cancellationToken,
                        JsonSerializer.SerializeToElement(new { input, context }).GetRawText()
                    )
                    .ConfigureAwait(false);
            },
            cancellationToken
        );

    /// <inheritdoc/>
    public async Task UpdateTaskAsync(
        TaskEditInput input,
        CancellationToken cancellationToken = default
    )
    {
        try
        {
            await SaveTaskEditAsync(input, cancellationToken).ConfigureAwait(false);
        }
        catch (FacetSavedObservationException)
        {
            // The applied receipt is authoritative; the store retains its refresh notice.
        }
    }

    /// <inheritdoc/>
    public Task<TaskItem> SaveTaskEditAsync(
        TaskEditInput input,
        CancellationToken cancellationToken = default
    ) =>
        SerializedAsync(
            async () =>
            {
                if (input.ChangedProperties is null)
                    throw new ArgumentException(
                        "Load this task in the editor before saving a reviewed field patch.",
                        nameof(input)
                    );
                if (input.ProfileId != Selected)
                    throw new ArgumentException(
                        "Select the original vault before saving this draft.",
                        nameof(input)
                    );
                if (input.ExpectedRevision is null)
                    throw new ArgumentException(
                        "Reload this task before saving an edit without its original revision.",
                        nameof(input)
                    );
                var command = new Dictionary<string, object?>
                {
                    ["kind"] = "edit_task",
                    ["path"] = input.Id,
                    ["expectedRevision"] = input.ExpectedRevision,
                    ["properties"] = input
                        .ChangedProperties.Where(pair => pair.Key != "status")
                        .ToDictionary(
                            pair => pair.Key,
                            pair => pair.Value.Clone(),
                            StringComparer.Ordinal
                        ),
                    ["occurrenceDate"] = input.OccurrenceDate,
                };
                if (input.ChangedProperties.TryGetValue("status", out var status))
                    command["status"] = status;
                if (input.BodyChanged)
                    command["body"] = input.Details ?? string.Empty;
                JsonElement receipt = await MutateAsync(
                        command,
                        false,
                        cancellationToken,
                        requireTaskResult: true
                    )
                    .ConfigureAwait(false);
                string taskPath = receipt.GetProperty("taskPath").GetString()!;
                return State.AllTasks.Single(task =>
                    task.ProfileId == input.ProfileId && task.VaultPath == taskPath
                );
            },
            cancellationToken
        );

    /// <inheritdoc/>
    public Task DeleteTaskAsync(string taskId, CancellationToken cancellationToken = default) =>
        CommandAsync(() => DeleteCommand(taskId), false, cancellationToken);

    /// <inheritdoc/>
    public Task SetStatusAsync(
        string taskId,
        string status,
        CancellationToken cancellationToken = default
    ) =>
        CommandAsync(
            () =>
            {
                var task = RequireTask(taskId);
                return new
                {
                    kind = "set_status",
                    path = PathOf(task),
                    expectedRevision = Revision(task),
                    status,
                    occurrenceDate = Text(task, "occurrenceDate"),
                };
            },
            false,
            cancellationToken
        );

    /// <inheritdoc/>
    public Task SetCompletionAsync(
        string taskId,
        bool completed,
        CancellationToken cancellationToken = default
    ) => CommandAsync(() => CompletionCommand(taskId, completed), true, cancellationToken);

    /// <inheritdoc/>
    public Task CompleteTasksAsync(
        IReadOnlyList<string> taskIds,
        CancellationToken cancellationToken = default
    ) =>
        CommandAsync(
            () =>
                new
                {
                    kind = "batch",
                    commands = taskIds.Select(id => CompletionCommand(id, true)).ToArray(),
                },
            true,
            cancellationToken
        );

    /// <inheritdoc/>
    public Task UndoCompletionAsync(CancellationToken cancellationToken = default) =>
        SerializedAsync(
            async () =>
            {
                var retainedUndo = _journal
                    .PendingEntries.Where(entry =>
                        entry.Profile == Selected
                        && JsonSerializer
                            .Deserialize<JsonElement>(entry.Document)
                            .GetProperty("command")
                            .GetProperty("kind")
                            .GetString() == "undo"
                    )
                    .ToArray();
                if (retainedUndo.Length > 1)
                    throw new ArgumentException(
                        "Review the retained Undo actions in Settings before continuing."
                    );
                if (retainedUndo.Length == 1)
                {
                    var retained = retainedUndo[0];
                    string originalReceipt = JsonSerializer
                        .Deserialize<JsonElement>(retained.Document)
                        .GetProperty("command")
                        .GetProperty("receiptId")
                        .GetString()!;
                    await ApplyMutationAsync(
                            retained,
                            false,
                            cancellationToken,
                            _journal.UndoHead(Selected) == originalReceipt ? originalReceipt : null
                        )
                        .ConfigureAwait(false);
                    return;
                }
                var available = await FeatureAsync(
                        new { kind = "undo_available" },
                        cancellationToken
                    )
                    .ConfigureAwait(false);
                string receipt =
                    available.GetProperty("receiptId").GetString()
                    ?? throw new InvalidOperationException("No saved change is available to undo.");
                await MutateAsync(
                        new { kind = "undo", receiptId = receipt },
                        false,
                        cancellationToken,
                        undoReceiptId: _journal.UndoHead(Selected) == receipt ? receipt : null
                    )
                    .ConfigureAwait(false);
            },
            cancellationToken
        );

    /// <inheritdoc/>
    public Task ScheduleTasksAsync(
        IReadOnlyList<string> taskIds,
        string? scheduled,
        CancellationToken cancellationToken = default
    ) => BatchPropertiesAsync(taskIds, new { scheduled }, cancellationToken);

    /// <inheritdoc/>
    public Task PrioritizeTasksAsync(
        IReadOnlyList<string> taskIds,
        string priority,
        CancellationToken cancellationToken = default
    ) => BatchPropertiesAsync(taskIds, new { priority }, cancellationToken);

    /// <inheritdoc/>
    public Task DeleteTasksAsync(
        IReadOnlyList<string> taskIds,
        CancellationToken cancellationToken = default
    ) =>
        CommandAsync(
            () => new { kind = "batch", commands = taskIds.Select(DeleteCommand).ToArray() },
            false,
            cancellationToken
        );

    /// <inheritdoc/>
    public Task LoadTaskTimeAsync(string taskId, CancellationToken cancellationToken = default)
    {
        _ = BeginNoticeRequest();
        var owner = CaptureTrackingOwner(taskId);
        _historyOwner = owner;
        return SerializedAsync(
            () => PublishTaskTimeAsync(taskId, cancellationToken, owner),
            cancellationToken
        );
    }

    private FacetTrackingOwner CaptureTrackingOwner(string? taskId)
    {
        string profile = Selected;
        if (_indexedProfileId != profile)
            throw new InvalidOperationException("Refresh the vault before reading tracked time.");
        ulong version =
            State.FacetIndexVersion
            ?? throw new InvalidOperationException(
                "Refresh the vault before reading tracked time."
            );
        var task = taskId is null
            ? null
            : State.AllTasks.Single(row => row.Id == taskId && row.ProfileId == profile);
        if (task is not null && (task.VaultPath is null || task.ExpectedRevision is null))
            throw new InvalidDataException(
                "The tracking task has no authoritative path or revision."
            );
        return new(
            profile,
            version,
            Timestamp(),
            Interlocked.Increment(ref _trackingRequestGeneration),
            _trackingEngineGeneration,
            task?.VaultPath,
            task?.ExpectedRevision
        );
    }

    private bool OwnsTracking(FacetTrackingOwner owner) =>
        !_disposed
        && Selected == owner.ProfileId
        && State.FacetIndexVersion == owner.Version
        && _trackingEngineGeneration == owner.EngineGeneration
        && (owner.TaskPath is null ? _sessionsOwner : _historyOwner) == owner;

    private async Task PublishTaskTimeAsync(
        string taskId,
        CancellationToken cancellationToken,
        FacetTrackingOwner? captured = null
    )
    {
        var owner = captured ?? CaptureTrackingOwner(taskId);
        if (captured is null)
            _historyOwner = owner;
        if (!OwnsTracking(owner))
            return;
        var page = await FacetTrackingReader
            .ReadPageAsync(_receiptSchema, owner, null, _engine.FeaturesAsync, cancellationToken)
            .ConfigureAwait(false);
        if (!OwnsTracking(owner))
            return;
        if (page.ProblemCount != 0)
        {
            State = State with { TrackingHistory = page, TaskTime = null };
            Notify();
            throw new ArgumentException(
                "Some tracking entries could not be read. Review this task's time entries."
            );
        }
        var totals = await FacetTrackingReader
            .ReadTotalsAsync(_receiptSchema, owner, _engine.FeaturesAsync, cancellationToken)
            .ConfigureAwait(false);
        if (!OwnsTracking(owner))
            return;
        State = State with
        {
            TaskTime = new TaskTimeReading(
                taskId,
                checked((uint)totals.TotalMinutes),
                totals.HasActiveSession
            ),
            TrackingHistory = page,
        };
        Notify();
    }

    /// <inheritdoc/>
    public Task LoadNextTrackingHistoryAsync(CancellationToken cancellationToken = default)
    {
        _ = BeginNoticeRequest();
        var page =
            State.TrackingHistory
            ?? throw new InvalidOperationException(
                "Refresh tracked time before continuing its history."
            );
        var continuation =
            page.Next ?? throw new InvalidOperationException("There are no more tracking entries.");
        return SerializedAsync(
            async () =>
            {
                if (!OwnsTracking(page.Owner))
                    return;
                var next = await FacetTrackingReader
                    .ReadPageAsync(
                        _receiptSchema,
                        page.Owner,
                        continuation,
                        _engine.FeaturesAsync,
                        cancellationToken
                    )
                    .ConfigureAwait(false);
                if (!OwnsTracking(page.Owner))
                    return;
                State = State with { TrackingHistory = next };
                Notify();
            },
            cancellationToken
        );
    }

    /// <inheritdoc/>
    public Task LoadTrackingSessionsAsync(
        bool nextPage = false,
        CancellationToken cancellationToken = default
    )
    {
        _ = BeginNoticeRequest();
        var current = nextPage
            ? State.TrackingSessions
                ?? throw new InvalidOperationException(
                    "Refresh running sessions before continuing."
                )
            : null;
        var owner = current?.Owner ?? CaptureTrackingOwner(null);
        var continuation = current?.Next;
        if (nextPage && continuation is null)
            throw new InvalidOperationException("There are no more running sessions.");
        if (!nextPage)
            _sessionsOwner = owner;
        return SerializedAsync(
            async () =>
            {
                if (!OwnsTracking(owner))
                    return;
                var page = await FacetTrackingReader
                    .ReadPageAsync(
                        _receiptSchema,
                        owner,
                        continuation,
                        _engine.FeaturesAsync,
                        cancellationToken
                    )
                    .ConfigureAwait(false);
                if (!OwnsTracking(owner))
                    return;
                State = State with { TrackingSessions = page };
                Notify();
            },
            cancellationToken
        );
    }

    /// <inheritdoc/>
    public Task StartTimeTrackingAsync(
        string taskId,
        CancellationToken cancellationToken = default
    ) => TimeCommandAsync(taskId, "start_time", cancellationToken);

    /// <inheritdoc/>
    public Task StopTimeTrackingAsync(
        string taskId,
        CancellationToken cancellationToken = default
    ) => TimeCommandAsync(taskId, "stop_time", cancellationToken);

    /// <inheritdoc/>
    public Task LoadTimeReportAsync(
        string period = "all",
        CancellationToken cancellationToken = default
    ) =>
        SerializedAsync(
            async () =>
            {
                DateTimeOffset now = _time.GetUtcNow();
                DateTime today = TimeZoneInfo.ConvertTime(now, _time.LocalTimeZone).Date;
                DateTimeOffset StartOf(DateTime date) =>
                    new(date, _time.LocalTimeZone.GetUtcOffset(date));
                DateTimeOffset start = period switch
                {
                    "all" => DateTimeOffset.UnixEpoch,
                    "today" => StartOf(today),
                    "week" => StartOf(today.AddDays(-6)),
                    "month" => StartOf(new DateTime(today.Year, today.Month, 1)),
                    _ => throw new ArgumentException("Unknown report period.", nameof(period)),
                };
                JsonElement report = await FeatureAsync(
                        new
                        {
                            kind = "time_report",
                            from = start.ToString("O", CultureInfo.InvariantCulture),
                            to = now.ToString("O", CultureInfo.InvariantCulture),
                            at = now.ToString("O", CultureInfo.InvariantCulture),
                        },
                        cancellationToken
                    )
                    .ConfigureAwait(false);
                State = State with
                {
                    TimeReport = new TimeReportReading(
                        report.GetProperty("totalMinutes").GetUInt32(),
                        report
                            .GetProperty("rows")
                            .EnumerateArray()
                            .Select(row => new TimeReportRow(
                                row.GetProperty("path").GetString()!,
                                row.GetProperty("title").GetString()!,
                                row.GetProperty("minutes").GetUInt32()
                            ))
                            .ToArray()
                    ),
                };
                Notify();
            },
            cancellationToken
        );

    /// <inheritdoc/>
    public Task LoadPomodoroAsync(CancellationToken cancellationToken = default) =>
        SerializedAsync(() => PublishPomodoroAsync(cancellationToken), cancellationToken);

    /// <inheritdoc/>
    public Task StartPomodoroAsync(string? taskId, CancellationToken cancellationToken = default) =>
        PomodoroCommandAsync("start", taskId, cancellationToken);

    /// <inheritdoc/>
    public Task PauseOrResumePomodoroAsync(CancellationToken cancellationToken = default) =>
        PomodoroCommandAsync(
            State.Pomodoro?.Phase == "paused" ? "resume" : "pause",
            null,
            cancellationToken
        );

    /// <inheritdoc/>
    public Task StopPomodoroAsync(CancellationToken cancellationToken = default) =>
        PomodoroCommandAsync("stop", null, cancellationToken);

    /// <inheritdoc/>
    public Task<SavedViewDefinition> CreateSavedViewAsync(
        string name,
        string symbol,
        string tint,
        bool favorite,
        TaskListQuery query,
        CancellationToken cancellationToken = default
    ) =>
        SerializedAsync(
            async () =>
            {
                string id = Guid.NewGuid().ToString("N");
                var view = new
                {
                    schemaVersion = 1,
                    name,
                    symbol,
                    tint,
                    favorite,
                    order = State.SavedViews.Count,
                    query = QueryDocument(query, 0),
                };
                await MutateAsync(
                        new
                        {
                            kind = "save_view",
                            id,
                            view,
                        },
                        false,
                        cancellationToken
                    )
                    .ConfigureAwait(false);
                return State.SavedViews.Single(v => v.Id == id);
            },
            cancellationToken
        );

    /// <inheritdoc/>
    public Task UpdateSavedViewAsync(
        SavedViewDefinition view,
        CancellationToken cancellationToken = default
    ) =>
        CommandAsync(
            () =>
            {
                using var query = JsonDocument.Parse(view.FilterJson);
                var preserved = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(
                    RequireView(view.Id).GetProperty("view").GetRawText()
                )!;
                preserved["schemaVersion"] = JsonSerializer.SerializeToElement(1);
                preserved["name"] = JsonSerializer.SerializeToElement(view.Name);
                preserved["symbol"] = JsonSerializer.SerializeToElement(view.Symbol);
                preserved["tint"] = JsonSerializer.SerializeToElement(view.Tint);
                preserved["favorite"] = JsonSerializer.SerializeToElement(view.IsFavorite);
                preserved["order"] = JsonSerializer.SerializeToElement(view.Order);
                preserved["query"] = query.RootElement.Clone();
                return new
                {
                    kind = "save_view",
                    id = view.Id,
                    view = preserved,
                };
            },
            false,
            cancellationToken
        );

    /// <inheritdoc/>
    public Task<SavedViewDefinition> DuplicateSavedViewAsync(
        string viewId,
        CancellationToken cancellationToken = default
    ) =>
        SerializedAsync(
            async () =>
            {
                string id = Guid.NewGuid().ToString("N");
                var saved = RequireView(viewId);
                var view = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(
                    saved.GetProperty("view").GetRawText()
                )!;
                view["name"] = JsonSerializer.SerializeToElement(
                    view["name"].GetString() + " copy"
                );
                view["order"] = JsonSerializer.SerializeToElement(State.SavedViews.Count);
                await MutateAsync(
                        new
                        {
                            kind = "save_view",
                            id,
                            view,
                        },
                        false,
                        cancellationToken
                    )
                    .ConfigureAwait(false);
                return State.SavedViews.Single(v => v.Id == id);
            },
            cancellationToken
        );

    /// <inheritdoc/>
    public Task DeleteSavedViewAsync(
        string viewId,
        CancellationToken cancellationToken = default
    ) =>
        CommandAsync(
            () =>
            {
                _ = RequireView(viewId);
                return new { kind = "delete_view", id = viewId };
            },
            false,
            cancellationToken
        );

    /// <inheritdoc/>
    public Task MoveSavedViewAsync(
        string viewId,
        int index,
        CancellationToken cancellationToken = default
    ) =>
        CommandAsync(
            () =>
            {
                var ids = State.SavedViews.Select(v => v.Id).ToList();
                if (!ids.Remove(viewId))
                    throw new ArgumentException("Unknown view.", nameof(viewId));
                ids.Insert(Math.Clamp(index, 0, ids.Count), viewId);
                return new { kind = "reorder_views", ids };
            },
            false,
            cancellationToken
        );

    /// <inheritdoc/>
    public Task RestoreDefaultSavedViewsAsync(CancellationToken cancellationToken = default) =>
        CommandAsync(() => new { kind = "restore_default_views" }, false, cancellationToken);

    /// <inheritdoc/>
    public Task RetryParkedMutationAsync(
        string mutationId,
        CancellationToken cancellationToken = default
    ) =>
        throw new InvalidOperationException("Resolve the retained versions in the conflict inbox.");

    /// <inheritdoc/>
    public Task DiscardParkedMutationAsync(
        string mutationId,
        CancellationToken cancellationToken = default
    ) =>
        throw new InvalidOperationException(
            "Choose a retained version explicitly in the conflict inbox."
        );

    /// <inheritdoc/>
    public Task ResumeMutationAsync(
        string mutationId,
        CancellationToken cancellationToken = default
    ) =>
        SerializedAsync(
            async () =>
            {
                var envelope = RetainedAction(mutationId);
                using var document = JsonDocument.Parse(envelope.Document);
                var command = document.RootElement.GetProperty("command");
                string? undoId =
                    command.GetProperty("kind").GetString() == "undo"
                        ? command.GetProperty("receiptId").GetString()
                        : null;
                if (_journal.UndoHead(Selected) != undoId)
                    undoId = null;
                await ApplyMutationAsync(
                        envelope,
                        IsCompletionAction(command),
                        cancellationToken,
                        undoId
                    )
                    .ConfigureAwait(false);
            },
            cancellationToken
        );

    /// <inheritdoc/>
    public Task RetireRejectedMutationAsync(
        string mutationId,
        CancellationToken cancellationToken = default
    ) =>
        SerializedAsync(
            async () =>
            {
                var envelope = RetainedAction(mutationId);
                using var status = JsonDocument.Parse(
                    await _engine
                        .FeaturesAsync(
                            envelope.Profile,
                            JsonSerializer.Serialize(new { kind = "mutation_receipt", mutationId }),
                            cancellationToken
                        )
                        .ConfigureAwait(false)
                );
                if (status.RootElement.GetProperty("mutationId").GetString() != mutationId)
                    throw new InvalidDataException(
                        "The retained action observation belongs to another identity."
                    );
                string state = status.RootElement.GetProperty("state").GetString()!;
                if (state is not "absent" and not "parked")
                    throw new ArgumentException(
                        "Pending and applied actions remain retained. Resume the original action before changing its decision.",
                        nameof(mutationId)
                    );
                _journal.RetireRejected(envelope);
                await PublishAsync().ConfigureAwait(false);
            },
            cancellationToken
        );

    private FacetMutationJournal.Entry RetainedAction(string mutationId)
    {
        var entry =
            _journal.PendingEntries.SingleOrDefault(e => e.Id == mutationId)
            ?? throw new ArgumentException(
                "The retained action no longer exists.",
                nameof(mutationId)
            );
        if (entry.Profile != Selected)
            throw new ArgumentException(
                "Select the retained action's owning vault before resuming it.",
                nameof(mutationId)
            );
        return entry;
    }

    private static bool IsCompletionAction(JsonElement command) =>
        command.GetProperty("kind").GetString() switch
        {
            "complete" or "set_completion" => true,
            "batch" => command.GetProperty("commands").EnumerateArray().Any(IsCompletionAction),
            _ => false,
        };

    private FacetPendingAction[] RetainedActions() =>
        _journal
            .PendingEntries.Select(entry =>
            {
                using var document = JsonDocument.Parse(entry.Document);
                return new FacetPendingAction(
                    entry.Id,
                    entry.Profile,
                    Profiles.Single(p => p.Id == entry.Profile).Name,
                    document.RootElement.GetProperty("command").GetProperty("kind").GetString()!
                );
            })
            .ToArray();

    /// <inheritdoc/>
    public Task<ObsidianSignInOutcome> SignInAsync(
        string email,
        string password,
        string mfa,
        CancellationToken cancellationToken = default
    ) =>
        SerializedAsync(
            async () =>
            {
                await StopSessionsAsync().ConfigureAwait(false);
                var result = await _account
                    .SignInAsync(email, password, mfa, cancellationToken)
                    .ConfigureAwait(false);
                if (result == ObsidianSignInOutcome.SignedIn)
                    foreach (
                        var profile in Profiles.Where(p =>
                            p.Vault is not null && p.AccountOwner is not null
                        )
                    )
                        _account.ForgetVault(profile.AccountOwner!, profile.Id, profile.Vault!.Id);
                return result;
            },
            cancellationToken
        );

    /// <inheritdoc/>
    public Task<IReadOnlyList<ObsidianVaultChoice>> ListVaultsAsync(
        CancellationToken cancellationToken = default
    )
    {
        _ = BeginNoticeRequest();
        return _account.ListVaultsAsync(cancellationToken);
    }

    /// <inheritdoc/>
    public Task AddRemoteProfileAsync(
        ObsidianVaultChoice vault,
        string? password,
        bool approveStandard,
        CancellationToken cancellationToken = default
    ) =>
        SerializedAsync(
            async () =>
            {
                string id = Guid.NewGuid().ToString("N");
                string? owner = _account.AccountOwner;
                await _account
                    .AuthorizeVaultAsync(id, vault.Id, password, cancellationToken)
                    .ConfigureAwait(false);
                string root = Path.Combine(_directory, "Replicas", id);
                try
                {
                    Directory.CreateDirectory(root);
                    var registration = new FacetProfileRegistration(
                        id,
                        vault.Name,
                        root,
                        true,
                        approveStandard,
                        _account.AccountOwner,
                        vault
                    );
                    await RegisterAsync(registration, cancellationToken).ConfigureAwait(false);
                }
                catch
                {
                    // Once the catalog commits, the replica and key belong to a
                    // recoverable profile even if its first refresh was interrupted.
                    if (!Profiles.Any(profile => profile.Id == id) && owner is not null)
                        _account.ForgetVault(owner, id, vault.Id);
                    throw;
                }
                await StartSessionsAsync(cancellationToken).ConfigureAwait(false);
            },
            cancellationToken
        );

    /// <inheritdoc/>
    public Task AddLocalProfileAsync(
        string name,
        string path,
        bool approveStandard,
        CancellationToken cancellationToken = default
    ) =>
        SerializedAsync(
            () =>
                RegisterAsync(
                    new FacetProfileRegistration(
                        Guid.NewGuid().ToString("N"),
                        name,
                        path,
                        false,
                        approveStandard,
                        null,
                        null
                    ),
                    cancellationToken
                ),
            cancellationToken
        );

    /// <inheritdoc/>
    public Task SelectProfileAsync(string id, CancellationToken cancellationToken = default) =>
        SerializedAsync(
            async () =>
            {
                InvalidateTracking();
                _catalog.Select(id);
                await PublishAsync().ConfigureAwait(false);
            },
            cancellationToken
        );

    /// <inheritdoc/>
    public async Task RemoveProfileAsync(string id, CancellationToken cancellationToken = default)
    {
        _ = BeginNoticeRequest();
        Interlocked.Increment(ref _sessionGeneration);
        if (_retainedSessions.TryGetValue(id, out var opening))
            opening.RequestStop();
        try
        {
            await SerializedAsync(
                    async () =>
                    {
                        var retainedRemoval = _catalog.PendingRemovals.FirstOrDefault(p =>
                            p.Id == id
                        );
                        if (retainedRemoval is not null)
                        {
                            using var native = JsonDocument.Parse(
                                await _engine.ProfilesAsync(cancellationToken).ConfigureAwait(false)
                            );
                            if (
                                !native
                                    .RootElement.GetProperty("profiles")
                                    .EnumerateArray()
                                    .Any(p => p.GetProperty("id").GetString() == id)
                            )
                            {
                                CompleteProfileRemoval(retainedRemoval);
                                await PublishAsync().ConfigureAwait(false);
                                return;
                            }
                        }
                        var profile = Profiles.Single(p => p.Id == id);
                        if (_journal.PendingEntries.Any(entry => entry.Profile == id))
                        {
                            await StartSessionsAsync(CancellationToken.None).ConfigureAwait(false);
                            throw new InvalidOperationException(
                                "Resume or retire this vault's retained actions before removing it."
                            );
                        }
                        if (_sessions.Remove(id, out var session))
                        {
                            _retainedSessions.TryRemove(id, out _);
                            await session.DisposeAsync().ConfigureAwait(false);
                        }
                        _catalog.BeginRemoval(id);
                        try
                        {
                            await _engine
                                .RemoveProfileAsync(id, cancellationToken)
                                .ConfigureAwait(false);
                        }
                        catch (Core.FacetEngineException.Conflict)
                        {
                            _catalog.FinishRemoval(id);
                            await StartSessionsAsync(CancellationToken.None).ConfigureAwait(false);
                            throw;
                        }
                        CompleteProfileRemoval(profile);
                        await StartSessionsAsync(cancellationToken).ConfigureAwait(false);
                        await PublishAsync().ConfigureAwait(false);
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
        }
        catch (Exception original)
        {
            try
            {
                await SerializedAsync(
                        async () =>
                        {
                            ExceptionDispatchInfo? cleanup = null;
                            try
                            {
                                await RecoverProfileRemovalsAsync(CancellationToken.None)
                                    .ConfigureAwait(false);
                            }
                            catch (Exception error)
                            {
                                cleanup = ExceptionDispatchInfo.Capture(error);
                            }
                            try
                            {
                                await StartSessionsAsync(CancellationToken.None)
                                    .ConfigureAwait(false);
                            }
                            catch (Exception error)
                            {
                                cleanup ??= ExceptionDispatchInfo.Capture(error);
                            }
                            try
                            {
                                await PublishAsync().ConfigureAwait(false);
                            }
                            catch (Exception error)
                            {
                                cleanup ??= ExceptionDispatchInfo.Capture(error);
                            }
                            cleanup?.Throw();
                        },
                        CancellationToken.None
                    )
                    .ConfigureAwait(false);
            }
            catch (Exception cleanup)
            {
                throw new AggregateException(
                    "Profile removal and its reconciliation failed; the durable owning intent remains retained.",
                    original,
                    cleanup
                );
            }
            throw;
        }
    }

    private void CompleteProfileRemoval(FacetProfileRegistration profile)
    {
        _catalog.ObserveRemoval(profile.Id);
        _catalog.CommitRemoval(profile.Id);
        if (profile.AccountOwner is not null && profile.Vault is not null)
            _account.ForgetVault(profile.AccountOwner, profile.Id, profile.Vault.Id);
        lock (_connection)
            _connection.Remove(profile.Id);
        _catalog.FinishRemoval(profile.Id);
    }

    private async Task RecoverProfileRemovalsAsync(CancellationToken cancellationToken)
    {
        if (_catalog.PendingRemovals.Count == 0)
            return;
        using var profiles = JsonDocument.Parse(
            await _engine.ProfilesAsync(cancellationToken).ConfigureAwait(false)
        );
        var existing = profiles
            .RootElement.GetProperty("profiles")
            .EnumerateArray()
            .Select(p => p.GetProperty("id").GetString()!)
            .ToHashSet(StringComparer.Ordinal);
        foreach (var pending in _catalog.PendingRemovals)
            if (!existing.Contains(pending.Id))
                CompleteProfileRemoval(pending);
    }

    /// <inheritdoc/>
    public Task ReauthorizeProfileAsync(
        string id,
        string? password,
        CancellationToken cancellationToken = default
    ) =>
        SerializedAsync(
            async () =>
            {
                var profile = Profiles.Single(p => p.Id == id);
                if (!profile.PrivateReplica || profile.Vault is null)
                    throw new ArgumentException("Select a private Sync replica.", nameof(id));
                if (_sessions.Remove(id, out var session))
                {
                    _retainedSessions.TryRemove(id, out _);
                    await session.DisposeAsync().ConfigureAwait(false);
                }
                var vaults = await _account
                    .ListVaultsAsync(cancellationToken)
                    .ConfigureAwait(false);
                var vault =
                    vaults.SingleOrDefault(v => v.Id == profile.Vault.Id)
                    ?? throw new InvalidOperationException(
                        "This account does not have access to the replica's remote vault."
                    );
                await _account
                    .AuthorizeVaultAsync(id, vault.Id, password, cancellationToken)
                    .ConfigureAwait(false);
                _catalog.Reauthorize(id, _account.AccountOwner, vault);
                await StartSessionsAsync(cancellationToken).ConfigureAwait(false);
                await PublishAsync().ConfigureAwait(false);
            },
            cancellationToken
        );

    /// <inheritdoc/>
    public Task SignOutAsync(CancellationToken cancellationToken = default) =>
        SerializedAsync(
            async () =>
            {
                await StopSessionsAsync().ConfigureAwait(false);
                foreach (
                    var profile in Profiles.Where(p =>
                        p.Vault is not null && p.AccountOwner is not null
                    )
                )
                    _account.ForgetVault(profile.AccountOwner!, profile.Id, profile.Vault!.Id);
                await _account
                    .SignOutAsync(Profiles.Select(p => p.Id), cancellationToken)
                    .ConfigureAwait(false);
                await PublishAsync().ConfigureAwait(false);
            },
            cancellationToken
        );

    /// <inheritdoc/>
    public Task<IReadOnlyList<FacetConflict>> ConflictsAsync(
        CancellationToken cancellationToken = default
    ) => SerializedAsync(() => ReadConflictsAsync(cancellationToken), cancellationToken);

    private async Task<IReadOnlyList<FacetConflict>> ReadConflictsAsync(
        CancellationToken cancellationToken
    )
    {
        List<FacetConflict> conflicts = [];
        string? cursor = null;
        do
        {
            using var document = JsonDocument.Parse(
                await _engine
                    .ConflictsPageAsync(Selected, cursor, cancellationToken)
                    .ConfigureAwait(false)
            );
            conflicts.AddRange(
                document
                    .RootElement.GetProperty("conflicts")
                    .EnumerateArray()
                    .Select(c => new FacetConflict(
                        c.GetProperty("id").GetString()!,
                        c.GetProperty("path").GetString()!,
                        ConflictVersion(c.GetProperty("base")),
                        ConflictVersion(c.GetProperty("local")),
                        ConflictVersion(c.GetProperty("remote")),
                        c.GetProperty("currentRevision").GetString()
                    ))
                    .ToArray()
            );
            string? next = document.RootElement.GetProperty("nextCursor").GetString();
            if (
                next is not null
                && cursor is not null
                && StringComparer.Ordinal.Compare(next, cursor) <= 0
            )
                throw new InvalidDataException("The conflict page cursor did not advance.");
            cursor = next;
        } while (cursor is not null);
        return (IReadOnlyList<FacetConflict>)conflicts;
    }

    private static FacetConflictVersion? ConflictVersion(JsonElement value) =>
        value.ValueKind == JsonValueKind.Null
            ? null
            : new FacetConflictVersion(
                value.GetProperty("size").GetUInt64(),
                value.GetProperty("revision").GetString()!
            );

    /// <inheritdoc/>
    public Task<byte[]?> ReadConflictPayloadAsync(
        string id,
        string version,
        CancellationToken cancellationToken = default
    ) =>
        SerializedAsync(
            () => _engine.ReadConflictPayloadAsync(Selected, id, version, cancellationToken),
            cancellationToken
        );

    /// <inheritdoc/>
    public Task ResolveConflictAsync(
        string id,
        string choice,
        CancellationToken cancellationToken = default
    ) =>
        SerializedAsync(
            async () =>
            {
                if (choice is not "keep_local" and not "keep_remote")
                    throw new ArgumentException(
                        "Choose a retained local or remote version.",
                        nameof(choice)
                    );
                string requestKey = $"resolve_conflict:{id}:{choice}";
                var envelope = _journal.Pending(Selected, requestKey);
                if (envelope is null)
                {
                    var conflict = (
                        await ReadConflictsAsync(cancellationToken).ConfigureAwait(false)
                    ).Single(c => c.Id == id);
                    envelope = _journal.Prepare(
                        Selected,
                        new
                        {
                            kind = "resolve_conflict",
                            conflictId = id,
                            expectedRevisions = new
                            {
                                @base = conflict.Base?.Revision,
                                local = conflict.Local?.Revision,
                                remote = conflict.Remote?.Revision,
                                current = conflict.CurrentRevision,
                            },
                            resolution = new { kind = choice },
                        },
                        requestKey
                    );
                }
                try
                {
                    await ApplyMutationAsync(envelope, false, cancellationToken)
                        .ConfigureAwait(false);
                }
                catch (Core.FacetEngineException.Conflict)
                {
                    var outcome = await FeatureAsync(
                            new { kind = "mutation_receipt", mutationId = envelope.Id },
                            cancellationToken
                        )
                        .ConfigureAwait(false);
                    if (outcome.GetProperty("mutationId").GetString() != envelope.Id)
                        throw new InvalidDataException(
                            "The decision receipt belongs to another mutation."
                        );
                    if (outcome.GetProperty("state").GetString() is "absent" or "parked")
                        _journal.RetireRejected(envelope);
                    throw;
                }
            },
            cancellationToken
        );

    private async Task RegisterAsync(
        FacetProfileRegistration profile,
        CancellationToken cancellationToken
    )
    {
        await _engine
            .RegisterProfileAsync(
                profile.Id,
                profile.Name,
                profile.RootPath,
                profile.PrivateReplica,
                profile.ApproveStandard,
                cancellationToken
            )
            .ConfigureAwait(false);
        try
        {
            _catalog.Add(profile);
        }
        catch
        {
            await _engine
                .Runner.RunAsync(
                    () =>
                    {
                        _engine.Engine.RemoveProfile(profile.Id);
                        _engine.Files.Unregister(profile.Id);
                        return true;
                    },
                    CancellationToken.None
                )
                .ConfigureAwait(false);
            throw;
        }
        try
        {
            await _engine.RefreshAsync(profile.Id, cancellationToken).ConfigureAwait(false);
        }
        catch (Core.FacetEngineException.Configuration error) when (profile.PrivateReplica)
        {
            lock (_connection)
                _connection[profile.Id] = (false, error.detail);
        }
        await PublishAsync().ConfigureAwait(false);
    }

    private async Task StartSessionsAsync(CancellationToken cancellationToken)
    {
        if (!_allowSync)
            return;
        long generation = Volatile.Read(ref _sessionGeneration);
        foreach (
            string id in _sessions
                .Where(pair => pair.Value.IsStopped)
                .Select(pair => pair.Key)
                .ToArray()
        )
        {
            await _sessions[id].DisposeAsync().ConfigureAwait(false);
            _sessions.Remove(id);
            _retainedSessions.TryRemove(id, out _);
        }
        foreach (
            var profile in Profiles.Where(p => p.PrivateReplica && !_sessions.ContainsKey(p.Id))
        )
        {
            try
            {
                _sessions.Add(
                    profile.Id,
                    await FacetSyncSession
                        .StartAsync(
                            _engine,
                            profile,
                            _account,
                            (connected, error) =>
                            {
                                lock (_connection)
                                    _connection[profile.Id] = (connected, error);
                                if (!_disposed)
                                    RequestUpdate();
                            },
                            cancellationToken,
                            _socketFactory,
                            candidate =>
                            {
                                if (
                                    _disposed
                                    || generation != Volatile.Read(ref _sessionGeneration)
                                )
                                    return false;
                                return _retainedSessions.TryAdd(profile.Id, candidate);
                            }
                        )
                        .ConfigureAwait(false)
                );
            }
            catch (FacetAuthorizationRequiredException)
            {
                lock (_connection)
                    _connection[profile.Id] = (
                        false,
                        "Authorize this vault with the signed-in Obsidian account."
                    );
            }
            finally
            {
                if (!_sessions.ContainsKey(profile.Id))
                    _retainedSessions.TryRemove(profile.Id, out _);
            }
        }
    }

    private async Task StopSessionsAsync()
    {
        Interlocked.Increment(ref _sessionGeneration);
        foreach (var retained in _retainedSessions.Values)
            retained.RequestStop();
        var sessions = _sessions.Values.ToArray();
        _sessions.Clear();
        _retainedSessions.Clear();
        ExceptionDispatchInfo? failure = null;
        foreach (var session in sessions)
            try
            {
                await session.DisposeAsync().ConfigureAwait(false);
            }
            catch (Exception error)
            {
                failure ??= ExceptionDispatchInfo.Capture(error);
            }
        failure?.Throw();
    }

    private Task<JsonElement> CommandAsync(
        Func<object> command,
        bool completion,
        CancellationToken cancellationToken
    ) =>
        SerializedAsync(
            () => MutateAsync(command(), completion, cancellationToken),
            cancellationToken
        );

    private Task<JsonElement> BatchPropertiesAsync(
        IReadOnlyList<string> ids,
        object properties,
        CancellationToken cancellationToken
    ) =>
        CommandAsync(
            () =>
                new
                {
                    kind = "batch",
                    commands = ids.Select(id =>
                        {
                            var task = RequireTask(id);
                            return new
                            {
                                kind = "update",
                                path = PathOf(task),
                                expectedRevision = Revision(task),
                                properties,
                            };
                        })
                        .ToArray(),
                },
            false,
            cancellationToken
        );

    private object DeleteCommand(string id)
    {
        var task = RequireTask(id);
        return new
        {
            kind = "delete",
            path = PathOf(task),
            expectedRevision = Revision(task),
        };
    }

    private object CompletionCommand(string id, bool completed)
    {
        var task = RequireTask(id);
        return new
        {
            kind = "set_completion",
            path = PathOf(task),
            expectedRevision = Revision(task),
            completed,
            occurrenceDate = Text(task, "occurrenceDate"),
        };
    }

    private Task TimeCommandAsync(string id, string kind, CancellationToken cancellationToken) =>
        SerializedAsync(
            async () =>
            {
                var task = RequireTask(id);
                await MutateAsync(
                        new
                        {
                            kind,
                            path = PathOf(task),
                            expectedRevision = Revision(task),
                        },
                        false,
                        cancellationToken
                    )
                    .ConfigureAwait(false);
                await PublishTaskTimeAsync(id, cancellationToken).ConfigureAwait(false);
            },
            cancellationToken
        );

    private async Task<JsonElement> MutateAsync(
        object command,
        bool completion,
        CancellationToken cancellationToken,
        string? requestKey = null,
        string? undoReceiptId = null,
        bool requireTaskResult = false
    )
    {
        var envelope = _journal.Prepare(Selected, command, requestKey);
        State = State with { FacetPendingActions = RetainedActions() };
        Notify();
        return await ApplyMutationAsync(
                envelope,
                completion,
                cancellationToken,
                undoReceiptId,
                requireTaskResult
            )
            .ConfigureAwait(false);
    }

    private async Task<JsonElement> ApplyMutationAsync(
        FacetMutationJournal.Entry envelope,
        bool completion,
        CancellationToken cancellationToken,
        string? undoReceiptId = null,
        bool requireTaskResult = false
    )
    {
        if (envelope.Profile != Selected)
            throw new InvalidOperationException("The mutation belongs to another vault profile.");
        using (var retained = JsonDocument.Parse(envelope.Document))
            if (retained.RootElement.GetProperty("mutationId").GetString() != envelope.Id)
                throw new InvalidDataException(
                    "The retained envelope has an inconsistent action identity."
                );
        var owner = _noticeAuthority.Capture(
            _operationNoticeAdmission
                ?? throw new InvalidDataException("The mutation has no admitted operation owner."),
            envelope.Profile,
            envelope.Id
        );
        _noticeAuthority.PublishIfOwned(
            owner,
            SelectedProfileId,
            () =>
            {
                _noticeOwner = owner;
                _savedNotice = null;
                _savedMaintenance = null;
            }
        );
        string rawReceipt = await _engine
            .ExecuteAsync(Selected, envelope.Document, cancellationToken)
            .ConfigureAwait(false);
        // Validate the entire required receipt before reading codes or action outcome.
        var notice = FacetReceiptWarnings.Read(_receiptSchema, rawReceipt, owner);
        using var receipt = JsonDocument.Parse(rawReceipt);
        if (receipt.RootElement.GetProperty("mutationId").GetString() != envelope.Id)
            throw new InvalidDataException(
                "The native receipt belongs to another action identity."
            );
        if (!receipt.RootElement.GetProperty("applied").GetBoolean())
            throw new InvalidOperationException(
                "The mutation has not been applied. Its original envelope remains retained."
            );
        bool savedPublished = _noticeAuthority.PublishIfOwned(
            owner,
            SelectedProfileId,
            () =>
            {
                _savedNotice = notice;
                _savedMaintenance = receipt.RootElement.GetProperty("cleanupPending").GetBoolean()
                    ? "Saved. Vault cleanup is still pending."
                    : null;
                AssignSavedNotice(owner);
            }
        );
        if (savedPublished)
            Notify();
        // Keep the exact retry envelope until the new durable reading is available.
        // A reader/contract failure cannot turn a subsequent retry into a new create.
        try
        {
            await PublishAsync(owner).ConfigureAwait(false);
        }
        catch (Exception error) when (IsExpectedObservationFailure(error))
        {
            if (OwnsNotice(owner))
            {
                _savedMaintenance = "Saved. Refresh the vault to update the list.";
                PublishSavedNotice(owner);
            }
            RequestUpdate(owner);
            if (requireTaskResult)
                throw new FacetSavedObservationException(
                    "Saved. Refresh the vault to update the list.",
                    error
                );
            return receipt.RootElement.Clone();
        }
        if (requireTaskResult)
        {
            string? taskPath = receipt.RootElement.GetProperty("taskPath").GetString();
            if (
                taskPath is null
                || !State.AllTasks.Any(task =>
                    task.ProfileId == envelope.Profile && task.VaultPath == taskPath
                )
            )
                throw new InvalidDataException(
                    "The applied edit has no authoritative resulting task projection. Its original action remains retained."
                );
        }
        try
        {
            _journal.Complete(envelope, completion, undoReceiptId);
        }
        catch (Exception error) when (IsExpectedObservationFailure(error))
        {
            if (OwnsNotice(owner))
                _savedMaintenance = "Saved. Local cleanup is still pending.";
        }
        PublishSavedNotice(owner);
        RequestUpdate(owner);
        return receipt.RootElement.Clone();
    }

    private static bool IsExpectedObservationFailure(Exception error) =>
        error is not InvalidDataException && error is IOException or UnauthorizedAccessException;

    private void PublishSavedNotice(FacetNoticeOwner owner)
    {
        if (
            _noticeAuthority.PublishIfOwned(
                owner,
                SelectedProfileId,
                () => AssignSavedNotice(owner)
            )
        )
            Notify();
    }

    private void AssignSavedNotice(FacetNoticeOwner owner)
    {
        State = State with
        {
            FacetPendingActions = RetainedActions(),
            CanUndoCompletion = _undoReceiptId is not null,
            CompletionUndoDepth = _journal.UndoDepth(Selected),
            SavedNotice = OwnsNotice(owner) ? _savedNotice : null,
            SavedNoticeOwner = OwnsNotice(owner) ? owner : null,
            SavedMaintenance = OwnsNotice(owner) ? _savedMaintenance : null,
        };
    }

    private async Task<JsonElement> FeatureAsync(
        object request,
        CancellationToken cancellationToken
    )
    {
        using var document = JsonDocument.Parse(
            await _engine
                .FeaturesAsync(
                    Selected,
                    JsonSerializer.SerializeToElement(request).GetRawText(),
                    cancellationToken
                )
                .ConfigureAwait(false)
        );
        return document.RootElement.Clone();
    }

    private async Task PublishPomodoroAsync(CancellationToken cancellationToken)
    {
        var result = await FeatureAsync(
                new
                {
                    kind = "pomodoro",
                    deviceId = _catalog.DeviceId,
                    at = Timestamp(),
                },
                cancellationToken
            )
            .ConfigureAwait(false);
        string status = result.GetProperty("status").GetString()!;
        uint remaining =
            result.GetProperty("durationSeconds").GetUInt32()
            - Math.Min(
                result.GetProperty("durationSeconds").GetUInt32(),
                result.GetProperty("elapsedSeconds").GetUInt32()
            );
        State = State with
        {
            Pomodoro = new PomodoroReading(
                status is "running" or "paused",
                Text(result, "taskPath"),
                remaining,
                status
            ),
        };
        Notify();
    }

    private Task PomodoroCommandAsync(
        string action,
        string? taskId,
        CancellationToken cancellationToken
    ) =>
        SerializedAsync(
            async () =>
            {
                await MutateAsync(
                        new
                        {
                            kind = "pomodoro",
                            action,
                            deviceId = _catalog.DeviceId,
                            taskPath = taskId is null ? null : PathOf(RequireTask(taskId)),
                        },
                        false,
                        cancellationToken
                    )
                    .ConfigureAwait(false);
                await PublishPomodoroAsync(cancellationToken).ConfigureAwait(false);
            },
            cancellationToken
        );

    private async Task PublishAsync(FacetNoticeOwner? observationOwner = null)
    {
        try
        {
            await PublishSnapshotAsync(observationOwner).ConfigureAwait(false);
        }
        catch (Core.FacetEngineException.Configuration error)
        {
            // Configuration may be arriving through the initial remote download.
            // Do not approve defaults or stop its session merely to show a shell.
            State = TaskNotesState.Unconfigured with
            {
                SyncState = TaskNotesSyncState.SynchronizationError,
                UserFacingError = error.detail,
            };
            Notify();
        }
    }

    private async Task PublishSnapshotAsync(FacetNoticeOwner? observationOwner)
    {
        if (SelectedProfileId is null)
        {
            _undoReceiptId = null;
            State = TaskNotesState.Unconfigured;
            Notify();
            return;
        }
        var availableUndo = await FeatureAsync(
                new { kind = "undo_available" },
                CancellationToken.None
            )
            .ConfigureAwait(false);
        _undoReceiptId = availableUndo.GetProperty("receiptId").GetString();
        var all = await ReadTasksAsync(new TaskListQuery(TaskListKind.Browse))
            .ConfigureAwait(false);
        if (all.Snapshot.GetProperty("configuration").ValueKind == JsonValueKind.Null)
        {
            if (all.Tasks.Count != 0 || all.Snapshot.GetProperty("totalCount").GetUInt64() != 0)
                throw new InvalidDataException("An unconfigured vault cannot expose task rows.");
            _tasks.Clear();
            _views.Clear();
            State = TaskNotesState.Unconfigured with
            {
                SyncState = TaskNotesSyncState.SynchronizationError,
                FacetConflicts = await ReadConflictsAsync(CancellationToken.None)
                    .ConfigureAwait(false),
                FacetPendingActions = RetainedActions(),
                PendingCount = all.Snapshot.GetProperty("pendingCount").GetUInt32(),
                PendingIds = all
                    .Snapshot.GetProperty("pendingTaskIds")
                    .EnumerateArray()
                    .Select(id => id.GetString()!)
                    .ToHashSet(StringComparer.Ordinal),
                UserFacingError = string.Join(
                    " ",
                    all.Snapshot.GetProperty("problems")
                        .EnumerateArray()
                        .Select(problem => problem.GetProperty("message").GetString()!)
                ),
            };
            Notify();
            return;
        }
        _views.Clear();
        foreach (var view in all.Snapshot.GetProperty("views").EnumerateArray())
            _views.Add(view.GetProperty("id").GetString()!, view.Clone());
        if (
            State.Query.Kind == TaskListKind.SavedView
            && (State.Query.Scope is null || !_views.ContainsKey(State.Query.Scope))
        )
            State = State with { Query = new TaskListQuery(TaskListKind.Browse) };
        var visible = await ReadTasksAsync(State.Query).ConfigureAwait(false);
        var today =
            State.Query.Kind == TaskListKind.Today
                ? visible
                : await ReadTasksAsync(TaskListQuery.Today).ConfigureAwait(false);
        if (
            all.Snapshot.GetProperty("version").GetUInt64()
                != visible.Snapshot.GetProperty("version").GetUInt64()
            || all.Snapshot.GetProperty("version").GetUInt64()
                != today.Snapshot.GetProperty("version").GetUInt64()
        )
            throw new InvalidOperationException(
                "The vault changed while reading. Refresh to read one consistent snapshot."
            );
        _tasks.Clear();
        foreach (var task in all.Tasks)
            _tasks.Add(task.GetProperty("id").GetString()!, task);
        var configuration = visible.Snapshot.GetProperty("configuration");
        var pending = new HashSet<string>(
            visible
                .Snapshot.GetProperty("pendingTaskIds")
                .EnumerateArray()
                .Select(id => id.GetString()!),
            StringComparer.Ordinal
        );
        var projectedAll = all
            .Tasks.Select(task => Project(task, configuration, pending, ""))
            .ToArray();
        var conflicts = await ReadConflictsAsync(CancellationToken.None).ConfigureAwait(false);
        Dictionary<string, string> groups = new(StringComparer.Ordinal);
        foreach (var group in visible.Groups)
        foreach (var id in group.GetProperty("taskIds").EnumerateArray())
            groups[id.GetString()!] = group.GetProperty("key").GetString()!;
        var projectedVisible = visible
            .Tasks.Select(task =>
                Project(
                    task,
                    configuration,
                    pending,
                    groups.GetValueOrDefault(task.GetProperty("id").GetString()!, "")
                )
            )
            .ToArray();
        var connection = (Connected: true, Error: (string?)null);
        lock (_connection)
            connection = _connection.GetValueOrDefault(
                Selected,
                (Profiles.Single(p => p.Id == Selected).PrivateReplica ? false : true, null)
            );
        _indexedProfileId = Selected;
        _noticeAuthority.Observe(
            SelectedProfileId,
            currentNoticeOwner =>
            {
                State = State with
                {
                    AllTasks = projectedAll,
                    FacetIndexVersion = all.Snapshot.GetProperty("version").GetUInt64(),
                    TrackingHistory =
                        State.TrackingHistory?.Owner.Version
                        == all.Snapshot.GetProperty("version").GetUInt64()
                            ? State.TrackingHistory
                            : null,
                    TrackingSessions =
                        State.TrackingSessions?.Owner.Version
                        == all.Snapshot.GetProperty("version").GetUInt64()
                            ? State.TrackingSessions
                            : null,
                    FacetPendingActions = RetainedActions(),
                    FacetConflicts = conflicts,
                    VisibleTasks = projectedVisible,
                    TodayTasks = today
                        .Tasks.Select(t => Project(t, configuration, pending, ""))
                        .Select(t => new TodayTask(
                            t.Id,
                            t.Title,
                            t.Due,
                            t.Scheduled,
                            t.IsCompleted,
                            t.IsRecurring,
                            t.IsPending
                        ))
                        .ToArray(),
                    PendingIds = pending,
                    PendingCount = visible.Snapshot.GetProperty("pendingCount").GetUInt32(),
                    Projects = projectedAll
                        .SelectMany(t => t.Projects)
                        .Distinct(StringComparer.Ordinal)
                        .Order(StringComparer.Ordinal)
                        .ToArray(),
                    Contexts = projectedAll
                        .SelectMany(t => t.Contexts)
                        .Distinct(StringComparer.Ordinal)
                        .Order(StringComparer.Ordinal)
                        .ToArray(),
                    Tags = projectedAll
                        .SelectMany(t => t.Tags)
                        .Distinct(StringComparer.Ordinal)
                        .Order(StringComparer.Ordinal)
                        .ToArray(),
                    StatusChoices = Choices(configuration, "statuses"),
                    PriorityChoices = Choices(configuration, "priorities"),
                    SavedViews = _views.Values.Select(ProjectView).OrderBy(v => v.Order).ToArray(),
                    CanUndoCompletion = _undoReceiptId is not null,
                    CompletionUndoDepth = _journal.UndoDepth(Selected),
                    SyncState = connection.Connected
                        ? TaskNotesSyncState.Connected
                        : TaskNotesSyncState.CachedOffline,
                    UserFacingError = connection.Error,
                    SavedNotice =
                        currentNoticeOwner is not null
                        && currentNoticeOwner == observationOwner
                        && currentNoticeOwner == _noticeOwner
                            ? _savedNotice
                            : null,
                    SavedNoticeOwner =
                        currentNoticeOwner is not null
                        && currentNoticeOwner == observationOwner
                        && currentNoticeOwner == _noticeOwner
                            ? currentNoticeOwner
                            : null,
                    SavedMaintenance =
                        currentNoticeOwner is not null
                        && currentNoticeOwner == observationOwner
                        && currentNoticeOwner == _noticeOwner
                            ? _savedMaintenance
                            : null,
                    LastSyncTime = connection.Connected
                        ? DateTimeOffset.UtcNow
                        : State.LastSyncTime,
                };
            }
        );
        Notify();
    }

    private async Task<(
        List<JsonElement> Tasks,
        JsonElement Snapshot,
        List<JsonElement> Groups
    )> ReadTasksAsync(TaskListQuery query)
    {
        List<JsonElement> tasks = [];
        List<JsonElement> groups = [];
        JsonElement last = default;
        ulong? version = null;
        ulong? total = null;
        var frozenQuery = QueryDocument(query, 0);
        do
        {
            var request = new Dictionary<string, JsonElement>(frozenQuery, StringComparer.Ordinal)
            {
                ["offset"] = JsonSerializer.SerializeToElement(tasks.Count),
            };
            using var document = JsonDocument.Parse(
                await _engine
                    .SnapshotAsync(
                        Selected,
                        JsonSerializer.SerializeToElement(request).GetRawText()
                    )
                    .ConfigureAwait(false)
            );
            last = document.RootElement.Clone();
            ulong current = last.GetProperty("version").GetUInt64();
            ulong currentTotal = last.GetProperty("totalCount").GetUInt64();
            if (
                (version is not null && version != current)
                || (total is not null && total != currentTotal)
            )
                throw new InvalidOperationException(
                    "The vault changed while reading. Refresh to read one consistent snapshot."
                );
            version = current;
            total = currentTotal;
            groups.AddRange(
                last.GetProperty("groups").EnumerateArray().Select(group => group.Clone())
            );
            var page = last.GetProperty("tasks").EnumerateArray().Select(t => t.Clone()).ToArray();
            tasks.AddRange(page);
            if ((page.Length == 0 && (ulong)tasks.Count < total) || (ulong)tasks.Count > total)
                throw new InvalidDataException("The engine returned an incomplete page.");
        } while ((ulong)tasks.Count < total);
        return (tasks, last, groups);
    }

    private Dictionary<string, JsonElement> QueryDocument(TaskListQuery query, int offset)
    {
        DateTimeOffset now = _time.GetUtcNow();
        string today = TimeZoneInfo
            .ConvertTime(now, _time.LocalTimeZone)
            .ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        string at = now.ToString("O", CultureInfo.InvariantCulture);
        if (query.Kind == TaskListKind.SavedView)
        {
            var saved = RequireView(
                query.Scope ?? throw new ArgumentException("Select a saved view.")
            );
            var request = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(
                saved.GetProperty("view").GetProperty("query").GetRawText()
            )!;
            request["offset"] = JsonSerializer.SerializeToElement(offset);
            request["limit"] = JsonSerializer.SerializeToElement(1000);
            request["today"] = JsonSerializer.SerializeToElement(today);
            request["at"] = JsonSerializer.SerializeToElement(at);
            request["text"] = JsonSerializer.SerializeToElement(query.Search);
            return request;
        }
        return JsonSerializer
            .SerializeToElement(
                new
                {
                    schemaVersion = 1,
                    offset,
                    limit = 1000,
                    text = query.Search,
                    today,
                    at,
                    scope = query.Kind switch
                    {
                        TaskListKind.Today => "today",
                        TaskListKind.Upcoming => "upcoming",
                        TaskListKind.Completed => "completed",
                        TaskListKind.Inbox => "inbox",
                        _ => "all",
                    },
                    statuses = query.Statuses,
                    priorities = query.Priorities,
                    projects = query.Kind == TaskListKind.Project
                        ? new[] { query.Scope ?? throw new ArgumentException("Select a project.") }
                        : query.Projects,
                    contexts = query.Kind == TaskListKind.Context
                        ? new[] { query.Scope ?? throw new ArgumentException("Select a context.") }
                        : query.Contexts,
                    tags = query.Kind == TaskListKind.Tag
                        ? new[] { query.Scope ?? throw new ArgumentException("Select a tag.") }
                        : query.Tags,
                    hasNoDueDate = query.HasNoDueDate ? (bool?)true : null,
                    sortField = query.Sort switch
                    {
                        TaskSortChoice.AsSynchronized => "manual",
                        TaskSortChoice.EffectiveDate => "effectiveDate",
                        TaskSortChoice.DueDate => "dueDate",
                        TaskSortChoice.Priority => "priority",
                        TaskSortChoice.Title => "title",
                        _ => throw new ArgumentException("Unknown sort."),
                    },
                    sortDirection = query.Descending ? "desc" : "asc",
                    groupBy = query.Group switch
                    {
                        TaskGroupChoice.None => null,
                        TaskGroupChoice.Date => "effectiveDate",
                        TaskGroupChoice.Status => "status",
                        TaskGroupChoice.Priority => "priority",
                        TaskGroupChoice.Project => "project",
                        _ => throw new ArgumentException("Unknown grouping."),
                    },
                }
            )
            .EnumerateObject()
            .ToDictionary(p => p.Name, p => p.Value.Clone(), StringComparer.Ordinal);
    }

    private TaskItem Project(
        JsonElement task,
        JsonElement configuration,
        HashSet<string> pending,
        string group
    )
    {
        JsonElement properties = task.GetProperty("properties");
        string status = task.GetProperty("status").GetString()!;
        string priority = task.GetProperty("priority").GetString()!;
        return new TaskItem(
            task.GetProperty("id").GetString()!,
            task.GetProperty("title").GetString()!,
            task.GetProperty("body").GetString(),
            status,
            Label(configuration, "statuses", status),
            priority,
            Label(configuration, "priorities", priority),
            Text(properties, "due"),
            Text(properties, "scheduled"),
            Text(properties, "recurrence"),
            Text(properties, "recurrenceAnchor"),
            Strings(properties, "projects"),
            Strings(properties, "contexts"),
            Strings(properties, "tags"),
            properties.TryGetProperty("timeEstimate", out var estimate)
            && estimate.ValueKind == JsonValueKind.Number
            && estimate.TryGetUInt32(out uint wholeEstimate)
                ? wholeEstimate
                : null,
            task.GetProperty("totalTrackedMinutes").GetUInt32(),
            task.GetProperty("isBlocked").GetBoolean(),
            task.GetProperty("isBlocking").GetBoolean(),
            task.GetProperty("completed").GetBoolean(),
            task.GetProperty("isRecurring").GetBoolean(),
            pending.Contains(PathOf(task)),
            Text(task, "occurrenceDate"),
            group,
            task.GetProperty("hasActiveTimeSession").GetBoolean()
        )
        {
            Properties = properties.Clone(),
            ProfileId = Selected,
            VaultPath = PathOf(task),
            ExpectedRevision = Revision(task),
        };
    }

    private static SavedViewDefinition ProjectView(JsonElement saved)
    {
        JsonElement view = saved.GetProperty("view");
        return new SavedViewDefinition
        {
            Id = saved.GetProperty("id").GetString()!,
            Name = view.GetProperty("name").GetString()!,
            Symbol = Text(view, "symbol") ?? "Filter",
            Tint = Text(view, "tint") ?? "Accent",
            IsFavorite = view.TryGetProperty("favorite", out var favorite) && favorite.GetBoolean(),
            Order = view.TryGetProperty("order", out var order) ? order.GetInt32() : 0,
            FilterJson = view.GetProperty("query").GetRawText(),
            Group = view.GetProperty("query").TryGetProperty("groupBy", out var group)
                ? group.GetString() switch
                {
                    "effectiveDate" => TaskGroupChoice.Date,
                    "status" => TaskGroupChoice.Status,
                    "priority" => TaskGroupChoice.Priority,
                    "project" => TaskGroupChoice.Project,
                    _ => TaskGroupChoice.None,
                }
                : TaskGroupChoice.None,
        };
    }

    private static string Label(JsonElement config, string field, string value) =>
        config
            .GetProperty(field)
            .EnumerateArray()
            .Where(v => Text(v, "value") == value)
            .Select(v => Text(v, "label") ?? value)
            .FirstOrDefault()
        ?? value;

    private static WorkflowChoice[] Choices(JsonElement configuration, string field) =>
        configuration
            .GetProperty(field)
            .EnumerateArray()
            .Select(choice => new WorkflowChoice(
                choice.GetProperty("value").GetString()!,
                Text(choice, "label") ?? choice.GetProperty("value").GetString()!
            ))
            .ToArray();

    private JsonElement RequireTask(string id) =>
        _tasks.TryGetValue(id, out var task)
            ? task
            : throw new ArgumentException("The task no longer exists.", nameof(id));

    private JsonElement RequireView(string id) =>
        _views.TryGetValue(id, out var view)
            ? view
            : throw new ArgumentException("The saved view no longer exists.", nameof(id));

    private static string PathOf(JsonElement task) => task.GetProperty("path").GetString()!;

    private static string Revision(JsonElement task) => task.GetProperty("revision").GetString()!;

    private static string? Text(JsonElement value, string field) =>
        value.TryGetProperty(field, out var child) && child.ValueKind != JsonValueKind.Null
            ? child.GetString()
            : null;

    private static string[] Strings(JsonElement value, string field) =>
        value.TryGetProperty(field, out var child) && child.ValueKind != JsonValueKind.Null
            ? child.EnumerateArray().Select(v => v.GetString()!).ToArray()
            : [];

    private string Timestamp() => _time.GetUtcNow().ToString("O", CultureInfo.InvariantCulture);

    private string Today() =>
        TimeZoneInfo
            .ConvertTime(_time.GetUtcNow(), _time.LocalTimeZone)
            .ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private void Notify() => StateChanged?.Invoke(this, EventArgs.Empty);

    private void RequestUpdate(FacetNoticeOwner? observationOwner = null)
    {
        if (observationOwner is null)
            _ = BeginNoticeRequest();
        Interlocked.Exchange(ref _updateNoticeOwner, observationOwner);
        _updates.Request();
    }

    private async Task PublishUpdateAsync()
    {
        var observationOwner = Interlocked.Exchange(ref _updateNoticeOwner, null);
        await _operations.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_disposed)
                return;
            foreach (var session in _sessions.Values)
                await session.WakeAsync(CancellationToken.None).ConfigureAwait(false);
            await PublishAsync(observationOwner).ConfigureAwait(false);
        }
        finally
        {
            _operations.Release();
        }
    }

    private async Task SerializedAsync(Func<Task> action, CancellationToken cancellationToken)
    {
        var admission = BeginNoticeRequest();
        RetainOperation();
        try
        {
            await _operations.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                _operationNoticeAdmission = admission;
                await action().ConfigureAwait(false);
            }
            finally
            {
                _operations.Release();
            }
        }
        finally
        {
            ReleaseOperation();
        }
    }

    private async Task<T> SerializedAsync<T>(
        Func<Task<T>> action,
        CancellationToken cancellationToken
    )
    {
        var admission = BeginNoticeRequest();
        RetainOperation();
        try
        {
            await _operations.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                _operationNoticeAdmission = admission;
                return await action().ConfigureAwait(false);
            }
            finally
            {
                _operations.Release();
            }
        }
        finally
        {
            ReleaseOperation();
        }
    }

    private void RetainOperation()
    {
        lock (_disposeGate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            _activeOperations++;
        }
    }

    private void ReleaseOperation()
    {
        lock (_disposeGate)
            if (--_activeOperations == 0 && _disposed)
                _operationsDrained.TrySetResult(true);
    }

    /// <inheritdoc/>
    public ValueTask DisposeAsync()
    {
        lock (_disposeGate)
        {
            if (_disposeTask is not null)
                return new ValueTask(_disposeTask);
            _disposed = true;
            _noticeAuthority.Close(ClearNoticePresentation);
            InvalidateTracking();
            if (_activeOperations == 0)
                _operationsDrained.SetResult(true);
            _disposeTask = DisposeCoreAsync();
            return new ValueTask(_disposeTask);
        }
    }

    private async Task DisposeCoreAsync()
    {
        await _operationsDrained.Task.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        ExceptionDispatchInfo? failure = null;
        await _operations.WaitAsync(CancellationToken.None).ConfigureAwait(false);
        try
        {
            try
            {
                await StopSessionsAsync().ConfigureAwait(false);
            }
            catch (Exception error)
            {
                failure = ExceptionDispatchInfo.Capture(error);
            }
        }
        finally
        {
            _operations.Release();
        }
        foreach (
            var cleanup in new Func<ValueTask>[]
            {
                _updates.DisposeAsync,
                _account.DisposeAsync,
                _engine.DisposeAsync,
            }
        )
            try
            {
                await cleanup().ConfigureAwait(false);
            }
            catch (Exception error)
            {
                failure ??= ExceptionDispatchInfo.Capture(error);
            }
        _operations.Dispose();
        failure?.Throw();
    }
}
