using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using TaskNotes.Protocol;
using ProtocolTask = TaskNotes.Protocol.Task;
using Task = System.Threading.Tasks.Task;

namespace TaskNotes.Windows.Host;

public sealed partial class FacetSyncStore
{
    private sealed record UndoTaskState(
        string TaskId,
        bool WasCompleted,
        string? CompletedAt,
        string? DueDate,
        string? RecurrenceRule
    );

    private sealed record UndoBatchEntry(string ReceiptId, IReadOnlyList<UndoTaskState> Tasks);

    private sealed record SavedFilterPayload(
        TaskListQuery Query,
        string Symbol = "Filter",
        string Tint = "Accent"
    );

    /// <inheritdoc />
    public FacetFeedbackLease? CaptureFeedbackLease() => FeedbackScene?.Capture();

    /// <inheritdoc />
    public Task<QuickAddPreview> PreviewQuickAddAsync(
        string input,
        CancellationToken cancellationToken = default
    ) =>
        RunSerializedAsync(
            () =>
            {
                ParsedQuickCapture parsed = QuickCaptureParser.Parse(
                    input ?? string.Empty,
                    CurrentLocalDate(),
                    _query
                );
                return Task.FromResult(parsed.Preview);
            },
            cancellationToken
        );

    /// <inheritdoc />
    public async Task<QuickAddPreview> PreviewCaptureAsync(
        string input,
        TaskListQuery context,
        string? profile,
        FacetCaptureOptions options,
        CancellationToken cancellationToken = default
    ) =>
        (
            await PrepareCaptureAsync(input, context, profile, options, cancellationToken)
                .ConfigureAwait(false)
        ).Preview;

    /// <inheritdoc />
    public Task<FacetPreparedCapture> PrepareCaptureAsync(
        string input,
        TaskListQuery context,
        string? profile,
        FacetCaptureOptions options,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(options);
        FacetCaptureOptions frozen = options.Freeze() with
        {
            FeedbackLease = options.FeedbackLease ?? CaptureFeedbackLease(),
        };
        return RunSerializedAsync(
            () =>
            {
                if (profile is not null && profile != SelectedProfileId)
                {
                    throw new ArgumentException(
                        "Return to this capture's original workspace before previewing it."
                    );
                }
                ParsedQuickCapture parsed = QuickCaptureParser.Parse(
                    input ?? string.Empty,
                    CurrentLocalDate(),
                    context,
                    frozen
                );
                return Task.FromResult(
                    new FacetPreparedCapture(
                        profile ?? SelectedProfileId,
                        _feedbackSessionId,
                        Interlocked.Read(ref _feedbackGeneration),
                        parsed.Preview,
                        parsed.Description,
                        frozen
                    )
                );
            },
            cancellationToken
        );
    }

    /// <inheritdoc />
    public Task SubmitPreparedCaptureAsync(
        FacetPreparedCapture capture,
        Action<string> admitted,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(capture);
        ArgumentNullException.ThrowIfNull(admitted);
        return RunSerializedAsync(
            async () =>
            {
                if (
                    capture.Session != _feedbackSessionId
                    || capture.Generation != Interlocked.Read(ref _feedbackGeneration)
                )
                {
                    throw new ArgumentException(
                        "This prepared capture belongs to an older session. Preview it again."
                    );
                }
                if (capture.AdmittedActionId is string existingId)
                {
                    throw new ArgumentException(
                        $"This capture was already submitted as {existingId}."
                    );
                }
                if (string.IsNullOrWhiteSpace(capture.Preview.Title))
                    throw new ArgumentException("Add a task title.");

                string mutationId = EnqueueTaskFromPreviewUnlocked(
                    capture.Preview,
                    capture.Body,
                    capture.Options.FeedbackLease
                );
                capture.RecordAdmission(mutationId);
                admitted(mutationId);
                await SyncAfterLocalMutationUnlockedAsync(cancellationToken).ConfigureAwait(false);
            },
            cancellationToken
        );
    }

    /// <inheritdoc />
    public Task AddAsync(
        string input,
        TaskListQuery context,
        CancellationToken cancellationToken = default
    ) =>
        AddDetailedCaptureAsync(
            input,
            context,
            SelectedProfileId,
            new(),
            _ => { },
            cancellationToken
        );

    /// <inheritdoc />
    public Task AddCaptureAsync(
        string input,
        TaskListQuery context,
        string? profile,
        Action<string> actionAdmitted,
        CancellationToken cancellationToken = default
    ) => AddDetailedCaptureAsync(input, context, profile, new(), actionAdmitted, cancellationToken);

    /// <inheritdoc />
    public Task AddDetailedCaptureAsync(
        string input,
        TaskListQuery context,
        string? profile,
        FacetCaptureOptions options,
        Action<string> admitted,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(admitted);
        FacetFeedbackLease? lease = options.FeedbackLease ?? CaptureFeedbackLease();
        return RunSerializedAsync(
            async () =>
            {
                if (profile is not null && profile != SelectedProfileId)
                {
                    throw new ArgumentException(
                        "The capture's owning workspace changed before submission."
                    );
                }
                ParsedQuickCapture parsed = QuickCaptureParser.Parse(
                    input ?? string.Empty,
                    CurrentLocalDate(),
                    context,
                    options
                );
                if (string.IsNullOrWhiteSpace(parsed.Preview.Title))
                    throw new FacetValidationException("Add a task title.");

                string mutationId = EnqueueTaskFromPreviewUnlocked(
                    parsed.Preview,
                    parsed.Description,
                    lease
                );
                admitted(mutationId);
                await SyncAfterLocalMutationUnlockedAsync(cancellationToken).ConfigureAwait(false);
            },
            cancellationToken
        );
    }

    /// <inheritdoc />
    public async Task UpdateTaskAsync(
        TaskEditInput input,
        CancellationToken cancellationToken = default
    )
    {
        _ = await SaveTaskEditAsync(input, null, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public Task<TaskItem> SaveTaskEditAsync(
        TaskEditInput input,
        CancellationToken cancellationToken = default
    ) => SaveTaskEditAsync(input, null, cancellationToken);

    /// <summary>Applies an atomic task edit (including nullable <c>""</c> clears and reminders) and returns the updated projection.</summary>
    public Task<TaskItem> SaveTaskEditAsync(
        TaskEditInput input,
        Action<string>? actionAdmitted,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(input);
        FacetFeedbackLease? lease = CaptureFeedbackLease();
        return RunSerializedAsync(
            async () =>
            {
                string title = input.Title.Trim();
                if (title.Length == 0)
                    throw new FacetValidationException("A task title is required.");

                ProtocolTask existing = RequireProtocolTask(input.Id);
                DateTimeOffset now = _time.GetUtcNow();
                List<QueuedCommand> commands = [];

                string? targetProjectId = ResolveProjectUpdate(input, existing, commands);
                IReadOnlyList<string>? targetLabelIds = ResolveLabelsUpdate(
                    input,
                    existing,
                    commands
                );

                string? desiredDue = NullIfBlank(input.Due) ?? NullIfBlank(input.Scheduled);
                string? currentDue = existing.DueDate ?? ExtractDatePrefix(existing.DueDatetime);
                string? dueDatePatch = string.Equals(
                    desiredDue,
                    currentDue,
                    StringComparison.Ordinal
                )
                    ? null
                    : (desiredDue ?? string.Empty);
                string? dueDatetimePatch =
                    dueDatePatch is not null && existing.DueDatetime is not null
                        ? string.Empty
                        : null;

                string? desiredRule = NullIfBlank(input.Recurrence);
                string? recurrencePatch = string.Equals(
                    desiredRule,
                    existing.RecurrenceRule,
                    StringComparison.Ordinal
                )
                    ? null
                    : (desiredRule ?? string.Empty);

                string? desiredDetails = input.Details ?? string.Empty;
                string? descriptionPatch = string.Equals(
                    desiredDetails,
                    existing.Description,
                    StringComparison.Ordinal
                )
                    ? null
                    : desiredDetails;

                Priority desiredPriority = QuickCaptureParser.ParseProtocolPriority(input.Priority);
                Priority? priorityPatch =
                    desiredPriority == existing.Priority ? null : desiredPriority;

                string? sectionPatch = input.SectionId is null
                    ? null
                    : (
                        string.Equals(
                            NullIfBlank(input.SectionId),
                            existing.SectionId,
                            StringComparison.Ordinal
                        )
                            ? null
                            : input.SectionId
                    );

                string? parentPatch = input.ParentId is null
                    ? null
                    : (
                        string.Equals(
                            NullIfBlank(input.ParentId),
                            existing.ParentId,
                            StringComparison.Ordinal
                        )
                            ? null
                            : input.ParentId
                    );

                string updateUuid = NewUuid();
                commands.Add(
                    new QueuedCommand(
                        Uuid: updateUuid,
                        TempId: null,
                        Command: new SyncCommand.TaskUpdate(
                            new TaskUpdateArgs(
                                Id: existing.Id,
                                Title: string.Equals(
                                    title,
                                    existing.Title,
                                    StringComparison.Ordinal
                                )
                                    ? null
                                    : title,
                                Description: descriptionPatch,
                                Priority: priorityPatch,
                                ProjectId: targetProjectId,
                                SectionId: sectionPatch,
                                ParentId: parentPatch,
                                ChildOrder: input.ChildOrder,
                                DueDate: dueDatePatch,
                                DueDatetime: dueDatetimePatch,
                                RecurrenceRule: recurrencePatch,
                                LabelIds: targetLabelIds
                            )
                        )
                    )
                );

                bool wantCompleted = string.Equals(
                    input.Status,
                    "done",
                    StringComparison.OrdinalIgnoreCase
                );
                if (wantCompleted != existing.Completed)
                {
                    commands.Add(
                        new QueuedCommand(
                            Uuid: NewUuid(),
                            TempId: null,
                            Command: wantCompleted
                                ? new SyncCommand.TaskComplete(
                                    new TaskCompleteArgs(
                                        existing.Id,
                                        now.ToString("O", CultureInfo.InvariantCulture)
                                    )
                                )
                                : new SyncCommand.TaskUncomplete(
                                    new TaskUncompleteArgs(existing.Id)
                                )
                        )
                    );
                }

                if (
                    input.ChangedProperties is not null
                    && input.ChangedProperties.TryGetValue(
                        "reminders",
                        out JsonElement reminderElement
                    )
                    && reminderElement.ValueKind == JsonValueKind.Array
                )
                {
                    AppendReminderDiffCommands(existing.Id, reminderElement, commands);
                }

                _snapshot = _cache.EnqueueAndApply(commands, now);
                actionAdmitted?.Invoke(updateUuid);
                EmitFeedback(updateUuid, "saved", lease, [existing.Id]);
                await SyncAfterLocalMutationUnlockedAsync(cancellationToken).ConfigureAwait(false);

                return State.AllTasks.FirstOrDefault(t => t.Id == existing.Id)
                    ?? State.AllTasks.First(t => t.Title == title);
            },
            cancellationToken
        );
    }

    /// <inheritdoc />
    public Task DeleteTaskAsync(string taskId, CancellationToken cancellationToken = default) =>
        DeleteTasksAsync([taskId], cancellationToken);

    /// <inheritdoc />
    public Task DeleteTasksAsync(
        IReadOnlyList<string> taskIds,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(taskIds);
        FacetFeedbackLease? lease = CaptureFeedbackLease();
        return RunSerializedAsync(
            async () =>
            {
                if (taskIds.Count == 0)
                    return;
                List<QueuedCommand> commands = [];
                foreach (string id in taskIds.Distinct(StringComparer.Ordinal))
                {
                    _ = RequireProtocolTask(id);
                    commands.Add(
                        new QueuedCommand(
                            NewUuid(),
                            null,
                            new SyncCommand.TaskDelete(new TaskDeleteArgs(id))
                        )
                    );
                }
                _snapshot = _cache.EnqueueAndApply(commands, _time.GetUtcNow());
                EmitFeedback(commands[0].Uuid, "deleted", lease, taskIds);
                await SyncAfterLocalMutationUnlockedAsync(cancellationToken).ConfigureAwait(false);
            },
            cancellationToken
        );
    }

    /// <inheritdoc />
    public Task SetStatusAsync(
        string taskId,
        string status,
        CancellationToken cancellationToken = default
    ) => MoveTaskToBoardColumnAsync(taskId, status, null, cancellationToken);

    /// <summary>Moves a task across Todoist-style Board columns (section columns in Project scope, priority columns in global scope).</summary>
    public Task MoveTaskToBoardColumnAsync(
        string taskId,
        string columnValue,
        double? childOrder = null,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(taskId);
        ArgumentNullException.ThrowIfNull(columnValue);

        if (
            columnValue.Equals("done", StringComparison.OrdinalIgnoreCase)
            || columnValue.Equals("completed", StringComparison.OrdinalIgnoreCase)
        )
        {
            return SetCompletionAsync(taskId, completed: true, cancellationToken);
        }
        if (columnValue.Equals("open", StringComparison.OrdinalIgnoreCase))
        {
            return SetCompletionAsync(taskId, completed: false, cancellationToken);
        }

        return RunSerializedAsync(
            async () =>
            {
                ProtocolTask existing = RequireProtocolTask(taskId);
                double order =
                    childOrder
                    ?? (
                        _snapshot.Tasks.Count == 0 ? 1 : _snapshot.Tasks.Max(t => t.ChildOrder) + 1
                    );

                TaskUpdateArgs updateArgs;
                if (
                    columnValue.Length == 0
                    || columnValue.Equals(NoSectionColumnValue, StringComparison.OrdinalIgnoreCase)
                )
                {
                    updateArgs = new TaskUpdateArgs(
                        Id: existing.Id,
                        SectionId: string.Empty,
                        ChildOrder: order
                    );
                }
                else if (
                    _snapshot.Sections.FirstOrDefault(s => !s.IsDeleted && s.Id == columnValue)
                    is Section targetSection
                )
                {
                    updateArgs = new TaskUpdateArgs(
                        Id: existing.Id,
                        ProjectId: targetSection.ProjectId == existing.ProjectId
                            ? null
                            : targetSection.ProjectId,
                        SectionId: targetSection.Id,
                        ChildOrder: order
                    );
                }
                else
                {
                    Priority priority = QuickCaptureParser.ParseProtocolPriority(columnValue);
                    updateArgs = new TaskUpdateArgs(
                        Id: existing.Id,
                        Priority: priority,
                        ChildOrder: order
                    );
                }

                QueuedCommand command = new(
                    NewUuid(),
                    null,
                    new SyncCommand.TaskUpdate(updateArgs)
                );
                _snapshot = _cache.EnqueueAndApply([command], _time.GetUtcNow());
                await SyncAfterLocalMutationUnlockedAsync(cancellationToken).ConfigureAwait(false);
            },
            cancellationToken
        );
    }

    /// <inheritdoc />
    public Task SetCompletionAsync(
        string taskId,
        bool completed,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(taskId);
        FacetFeedbackLease? lease = CaptureFeedbackLease();
        return RunSerializedAsync(
            async () =>
            {
                ProtocolTask existing = RequireProtocolTask(taskId);
                DateTimeOffset now = _time.GetUtcNow();
                string uuid = NewUuid();

                RecordUndoSnapshot(uuid, [existing]);
                QueuedCommand command = new(
                    Uuid: uuid,
                    TempId: null,
                    Command: completed
                        ? new SyncCommand.TaskComplete(
                            new TaskCompleteArgs(
                                existing.Id,
                                now.ToString("O", CultureInfo.InvariantCulture)
                            )
                        )
                        : new SyncCommand.TaskUncomplete(new TaskUncompleteArgs(existing.Id))
                );

                _snapshot = _cache.EnqueueAndApply([command], now);
                EmitFeedback(uuid, completed ? "completed" : "reopened", lease, [existing.Id]);
                await SyncAfterLocalMutationUnlockedAsync(cancellationToken).ConfigureAwait(false);
            },
            cancellationToken
        );
    }

    /// <inheritdoc />
    public Task CompleteTasksAsync(
        IReadOnlyList<string> taskIds,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(taskIds);
        FacetFeedbackLease? lease = CaptureFeedbackLease();
        return RunSerializedAsync(
            async () =>
            {
                string[] distinct = taskIds.Distinct(StringComparer.Ordinal).ToArray();
                if (distinct.Length == 0)
                    return;

                DateTimeOffset now = _time.GetUtcNow();
                string iso = now.ToString("O", CultureInfo.InvariantCulture);
                List<ProtocolTask> originals = [];
                List<QueuedCommand> commands = [];
                foreach (string id in distinct)
                {
                    ProtocolTask task = RequireProtocolTask(id);
                    originals.Add(task);
                    commands.Add(
                        new QueuedCommand(
                            NewUuid(),
                            null,
                            new SyncCommand.TaskComplete(new TaskCompleteArgs(id, iso))
                        )
                    );
                }

                string receiptId = commands[0].Uuid;
                RecordUndoSnapshot(receiptId, originals);
                _snapshot = _cache.EnqueueAndApply(commands, now);
                EmitFeedback(receiptId, "completed", lease, distinct);
                await SyncAfterLocalMutationUnlockedAsync(cancellationToken).ConfigureAwait(false);
            },
            cancellationToken
        );
    }

    /// <inheritdoc />
    public Task UndoCompletionAsync(CancellationToken cancellationToken = default)
    {
        FacetFeedbackLease? lease = CaptureFeedbackLease();
        return RunSerializedAsync(
            async () =>
            {
                if (_undoStack.Count == 0)
                    throw new InvalidOperationException("No completion is available to undo.");

                UndoBatchEntry entry = _undoStack[^1];
                _undoStack.RemoveAt(_undoStack.Count - 1);

                DateTimeOffset now = _time.GetUtcNow();
                List<QueuedCommand> commands = [];
                List<string> affected = [];

                foreach (UndoTaskState snapshot in entry.Tasks)
                {
                    ProtocolTask? current = _snapshot.Tasks.FirstOrDefault(t =>
                        t.Id == snapshot.TaskId && !t.IsDeleted
                    );
                    if (current is null)
                        continue;

                    affected.Add(current.Id);
                    if (snapshot.WasCompleted != current.Completed)
                    {
                        commands.Add(
                            new QueuedCommand(
                                NewUuid(),
                                null,
                                snapshot.WasCompleted
                                    ? new SyncCommand.TaskComplete(
                                        new TaskCompleteArgs(current.Id, snapshot.CompletedAt)
                                    )
                                    : new SyncCommand.TaskUncomplete(
                                        new TaskUncompleteArgs(current.Id)
                                    )
                            )
                        );
                    }

                    bool dueChanged = !string.Equals(
                        snapshot.DueDate,
                        current.DueDate,
                        StringComparison.Ordinal
                    );
                    bool ruleChanged = !string.Equals(
                        snapshot.RecurrenceRule,
                        current.RecurrenceRule,
                        StringComparison.Ordinal
                    );
                    if (dueChanged || ruleChanged)
                    {
                        commands.Add(
                            new QueuedCommand(
                                NewUuid(),
                                null,
                                new SyncCommand.TaskUpdate(
                                    new TaskUpdateArgs(
                                        Id: current.Id,
                                        DueDate: dueChanged
                                            ? (snapshot.DueDate ?? string.Empty)
                                            : null,
                                        RecurrenceRule: ruleChanged
                                            ? (snapshot.RecurrenceRule ?? string.Empty)
                                            : null
                                    )
                                )
                            )
                        );
                    }
                }

                if (commands.Count > 0)
                {
                    _snapshot = _cache.EnqueueAndApply(commands, now);
                    EmitFeedback(commands[0].Uuid, "undone", lease, affected);
                    await SyncAfterLocalMutationUnlockedAsync(cancellationToken)
                        .ConfigureAwait(false);
                }
                else
                {
                    PublishSnapshot(_syncState, _userFacingError);
                }
            },
            cancellationToken
        );
    }

    /// <inheritdoc />
    public Task ScheduleTasksAsync(
        IReadOnlyList<string> taskIds,
        string? scheduled,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(taskIds);
        string patch = string.IsNullOrWhiteSpace(scheduled) ? string.Empty : scheduled.Trim();
        if (patch.Length > 0 && !RecurrenceCodec.TryParseCivilDate(patch, out _))
            throw new FacetValidationException("Schedule date must be YYYY-MM-DD.");

        return RunSerializedAsync(
            async () =>
            {
                List<QueuedCommand> commands = [];
                foreach (string id in taskIds.Distinct(StringComparer.Ordinal))
                {
                    ProtocolTask existing = RequireProtocolTask(id);
                    commands.Add(
                        new QueuedCommand(
                            NewUuid(),
                            null,
                            new SyncCommand.TaskUpdate(
                                new TaskUpdateArgs(
                                    Id: id,
                                    DueDate: patch,
                                    DueDatetime: existing.DueDatetime is not null
                                        ? string.Empty
                                        : null
                                )
                            )
                        )
                    );
                }
                if (commands.Count == 0)
                    return;
                _snapshot = _cache.EnqueueAndApply(commands, _time.GetUtcNow());
                await SyncAfterLocalMutationUnlockedAsync(cancellationToken).ConfigureAwait(false);
            },
            cancellationToken
        );
    }

    /// <inheritdoc />
    public Task PrioritizeTasksAsync(
        IReadOnlyList<string> taskIds,
        string priority,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(taskIds);
        Priority parsed = QuickCaptureParser.ParseProtocolPriority(priority);
        return RunSerializedAsync(
            async () =>
            {
                List<QueuedCommand> commands = [];
                foreach (string id in taskIds.Distinct(StringComparer.Ordinal))
                {
                    _ = RequireProtocolTask(id);
                    commands.Add(
                        new QueuedCommand(
                            NewUuid(),
                            null,
                            new SyncCommand.TaskUpdate(new TaskUpdateArgs(Id: id, Priority: parsed))
                        )
                    );
                }
                if (commands.Count == 0)
                    return;
                _snapshot = _cache.EnqueueAndApply(commands, _time.GetUtcNow());
                await SyncAfterLocalMutationUnlockedAsync(cancellationToken).ConfigureAwait(false);
            },
            cancellationToken
        );
    }

    /// <summary>Creates a new project optimistically and queues <c>project_add</c>.</summary>
    public Task<string> CreateProjectAsync(
        string name,
        string? color = null,
        bool isFavorite = false,
        CancellationToken cancellationToken = default
    )
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new FacetValidationException("Enter a project name.");
        string trimmed = name.Trim();
        return RunSerializedAsync(
            async () =>
            {
                string tempId = NewTempId("proj");
                QueuedCommand command = new(
                    NewUuid(),
                    tempId,
                    new SyncCommand.ProjectAdd(
                        new ProjectAddArgs(
                            Name: trimmed,
                            Color: color ?? "#808080",
                            ChildOrder: _snapshot.Projects.Count,
                            IsFavorite: isFavorite
                        )
                    )
                );
                _snapshot = _cache.EnqueueAndApply([command], _time.GetUtcNow());
                await SyncAfterLocalMutationUnlockedAsync(cancellationToken).ConfigureAwait(false);
                return _snapshot
                    .Projects.First(p =>
                        !p.IsDeleted && string.Equals(p.Name, trimmed, StringComparison.Ordinal)
                    )
                    .Id;
            },
            cancellationToken
        );
    }

    /// <summary>Creates a new section within a project optimistically and queues <c>section_add</c>.</summary>
    public Task<string> CreateSectionAsync(
        string projectId,
        string name,
        double? sectionOrder = null,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(projectId);
        if (string.IsNullOrWhiteSpace(name))
            throw new FacetValidationException("Enter a section name.");
        string trimmed = name.Trim();
        return RunSerializedAsync(
            async () =>
            {
                string tempId = NewTempId("sec");
                QueuedCommand command = new(
                    NewUuid(),
                    tempId,
                    new SyncCommand.SectionAdd(
                        new SectionAddArgs(
                            ProjectId: projectId,
                            Name: trimmed,
                            SectionOrder: sectionOrder
                                ?? _snapshot.Sections.Count(s => s.ProjectId == projectId)
                        )
                    )
                );
                _snapshot = _cache.EnqueueAndApply([command], _time.GetUtcNow());
                await SyncAfterLocalMutationUnlockedAsync(cancellationToken).ConfigureAwait(false);
                return _snapshot
                    .Sections.First(s =>
                        !s.IsDeleted
                        && s.ProjectId == projectId
                        && string.Equals(s.Name, trimmed, StringComparison.Ordinal)
                    )
                    .Id;
            },
            cancellationToken
        );
    }

    /// <summary>Creates a new label optimistically and queues <c>label_add</c>.</summary>
    public Task<string> CreateLabelAsync(
        string name,
        string? color = null,
        CancellationToken cancellationToken = default
    )
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new FacetValidationException("Enter a label name.");
        string trimmed = name.Trim();
        return RunSerializedAsync(
            async () =>
            {
                string tempId = NewTempId("lbl");
                QueuedCommand command = new(
                    NewUuid(),
                    tempId,
                    new SyncCommand.LabelAdd(
                        new LabelAddArgs(
                            Name: trimmed,
                            Color: color ?? "#808080",
                            ItemOrder: _snapshot.Labels.Count
                        )
                    )
                );
                _snapshot = _cache.EnqueueAndApply([command], _time.GetUtcNow());
                await SyncAfterLocalMutationUnlockedAsync(cancellationToken).ConfigureAwait(false);
                return _snapshot
                    .Labels.First(l =>
                        !l.IsDeleted && string.Equals(l.Name, trimmed, StringComparison.Ordinal)
                    )
                    .Id;
            },
            cancellationToken
        );
    }

    /// <inheritdoc />
    public Task<SavedViewDefinition> CreateSavedViewAsync(
        string name,
        string symbol,
        string tint,
        bool favorite,
        TaskListQuery query,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(query);
        string trimmed = name?.Trim() ?? string.Empty;
        if (trimmed.Length == 0)
            throw new FacetValidationException("Enter a saved-view name.");

        return RunSerializedAsync(
            async () =>
            {
                string tempId = NewTempId("flt");
                string serializedQuery = SerializeSavedFilterPayload(query, symbol, tint);
                QueuedCommand command = new(
                    NewUuid(),
                    tempId,
                    new SyncCommand.FilterAdd(
                        new FilterAddArgs(
                            Name: trimmed,
                            Query: serializedQuery,
                            Color: tint,
                            ItemOrder: _snapshot.Filters.Count(f => !f.IsDeleted),
                            IsFavorite: favorite
                        )
                    )
                );
                _snapshot = _cache.EnqueueAndApply([command], _time.GetUtcNow());
                await SyncAfterLocalMutationUnlockedAsync(cancellationToken).ConfigureAwait(false);
                return State.SavedViews.FirstOrDefault(v => v.Id == tempId)
                    ?? State.SavedViews.Last(v => v.Name == trimmed);
            },
            cancellationToken
        );
    }

    /// <inheritdoc />
    public Task UpdateSavedViewAsync(
        SavedViewDefinition view,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(view);
        if (string.IsNullOrWhiteSpace(view.Name))
            throw new FacetValidationException("Enter a saved-view name.");
        return RunSerializedAsync(
            async () =>
            {
                _ = RequireFilter(view.Id);
                TaskListQuery parsedQuery = ParseFilterQuery(view.FilterJson).Query;
                string payload = SerializeSavedFilterPayload(
                    parsedQuery with
                    {
                        Group = view.Group,
                    },
                    view.Symbol,
                    view.Tint
                );
                QueuedCommand command = new(
                    NewUuid(),
                    null,
                    new SyncCommand.FilterUpdate(
                        new FilterUpdateArgs(
                            Id: view.Id,
                            Name: view.Name.Trim(),
                            Query: payload,
                            Color: view.Tint,
                            ItemOrder: view.Order,
                            IsFavorite: view.IsFavorite
                        )
                    )
                );
                _snapshot = _cache.EnqueueAndApply([command], _time.GetUtcNow());
                await SyncAfterLocalMutationUnlockedAsync(cancellationToken).ConfigureAwait(false);
            },
            cancellationToken
        );
    }

    /// <inheritdoc />
    public Task<SavedViewDefinition> DuplicateSavedViewAsync(
        string viewId,
        CancellationToken cancellationToken = default
    ) =>
        RunSerializedAsync(
            async () =>
            {
                Filter source = RequireFilter(viewId);
                string copyName = $"{source.Name} copy";
                string tempId = NewTempId("flt");
                QueuedCommand command = new(
                    NewUuid(),
                    tempId,
                    new SyncCommand.FilterAdd(
                        new FilterAddArgs(
                            Name: copyName,
                            Query: source.Query,
                            Color: source.Color,
                            ItemOrder: _snapshot.Filters.Count(f => !f.IsDeleted),
                            IsFavorite: source.IsFavorite
                        )
                    )
                );
                _snapshot = _cache.EnqueueAndApply([command], _time.GetUtcNow());
                await SyncAfterLocalMutationUnlockedAsync(cancellationToken).ConfigureAwait(false);
                return State.SavedViews.FirstOrDefault(v => v.Id == tempId)
                    ?? State.SavedViews.Last(v => v.Name == copyName);
            },
            cancellationToken
        );

    /// <inheritdoc />
    public Task DeleteSavedViewAsync(
        string viewId,
        CancellationToken cancellationToken = default
    ) =>
        RunSerializedAsync(
            async () =>
            {
                _ = RequireFilter(viewId);
                QueuedCommand command = new(
                    NewUuid(),
                    null,
                    new SyncCommand.FilterDelete(new FilterDeleteArgs(viewId))
                );
                _snapshot = _cache.EnqueueAndApply([command], _time.GetUtcNow());
                await SyncAfterLocalMutationUnlockedAsync(cancellationToken).ConfigureAwait(false);
            },
            cancellationToken
        );

    /// <inheritdoc />
    public Task MoveSavedViewAsync(
        string viewId,
        int index,
        CancellationToken cancellationToken = default
    ) =>
        RunSerializedAsync(
            async () =>
            {
                List<Filter> ordered = _snapshot
                    .Filters.Where(f => !f.IsDeleted)
                    .OrderBy(f => f.ItemOrder)
                    .ToList();
                int currentIdx = ordered.FindIndex(f => f.Id == viewId);
                if (currentIdx < 0)
                    throw new ArgumentException("Unknown saved view.", nameof(viewId));

                Filter moving = ordered[currentIdx];
                ordered.RemoveAt(currentIdx);
                int clamped = Math.Clamp(index, 0, ordered.Count);
                ordered.Insert(clamped, moving);

                List<QueuedCommand> commands = [];
                for (int i = 0; i < ordered.Count; i++)
                {
                    if ((int)ordered[i].ItemOrder != i)
                    {
                        commands.Add(
                            new QueuedCommand(
                                NewUuid(),
                                null,
                                new SyncCommand.FilterUpdate(
                                    new FilterUpdateArgs(Id: ordered[i].Id, ItemOrder: i)
                                )
                            )
                        );
                    }
                }
                if (commands.Count > 0)
                {
                    _snapshot = _cache.EnqueueAndApply(commands, _time.GetUtcNow());
                    await SyncAfterLocalMutationUnlockedAsync(cancellationToken)
                        .ConfigureAwait(false);
                }
            },
            cancellationToken
        );

    /// <inheritdoc />
    public Task RestoreDefaultSavedViewsAsync(CancellationToken cancellationToken = default) =>
        RunSerializedAsync(
            async () =>
            {
                (string Name, string Symbol, string Tint, TaskListQuery Query)[] defaults =
                [
                    (
                        "Priority 1",
                        "Important",
                        "Accent",
                        new TaskListQuery(TaskListKind.Browse) { Priorities = ["p1"] }
                    ),
                    (
                        "No Due Date",
                        "Calendar",
                        "Neutral",
                        new TaskListQuery(TaskListKind.Browse) { HasNoDueDate = true }
                    ),
                ];

                List<QueuedCommand> commands = [];
                int nextOrder = _snapshot.Filters.Count(f => !f.IsDeleted);
                foreach (var item in defaults)
                {
                    if (
                        _snapshot.Filters.Any(f =>
                            !f.IsDeleted
                            && string.Equals(f.Name, item.Name, StringComparison.OrdinalIgnoreCase)
                        )
                    )
                    {
                        continue;
                    }
                    commands.Add(
                        new QueuedCommand(
                            NewUuid(),
                            NewTempId("flt"),
                            new SyncCommand.FilterAdd(
                                new FilterAddArgs(
                                    Name: item.Name,
                                    Query: SerializeSavedFilterPayload(
                                        item.Query,
                                        item.Symbol,
                                        item.Tint
                                    ),
                                    Color: item.Tint,
                                    ItemOrder: nextOrder++,
                                    IsFavorite: true
                                )
                            )
                        )
                    );
                }

                if (commands.Count > 0)
                {
                    _snapshot = _cache.EnqueueAndApply(commands, _time.GetUtcNow());
                    await SyncAfterLocalMutationUnlockedAsync(cancellationToken)
                        .ConfigureAwait(false);
                }
            },
            cancellationToken
        );

    /// <inheritdoc />
    public Task RetryParkedMutationAsync(
        string mutationId,
        CancellationToken cancellationToken = default
    ) =>
        RunSerializedAsync(
            async () =>
            {
                _snapshot = _cache.RetryParkedMutation(mutationId, NewUuid(), _time.GetUtcNow());
                await SyncAfterLocalMutationUnlockedAsync(cancellationToken).ConfigureAwait(false);
            },
            cancellationToken
        );

    /// <inheritdoc />
    public Task DiscardParkedMutationAsync(
        string mutationId,
        CancellationToken cancellationToken = default
    ) =>
        RunSerializedAsync(
            () =>
            {
                _snapshot = _cache.DiscardParkedMutation(mutationId);
                PublishSnapshot(_syncState, _userFacingError);
                return Task.CompletedTask;
            },
            cancellationToken
        );

    private string EnqueueTaskFromPreviewUnlocked(
        QuickAddPreview preview,
        string? description,
        FacetFeedbackLease? lease
    )
    {
        List<QueuedCommand> commands = [];
        string projectId = string.Empty;
        if (preview.Projects.Count > 0)
            projectId = EnsureProjectIdUnlocked(preview.Projects[0], commands);
        else if (_snapshot.Projects.FirstOrDefault(p => !p.IsDeleted && p.IsInbox) is Project inbox)
            projectId = inbox.Id;

        List<string> labelIds = [];
        foreach (string labelName in preview.Tags.Concat(preview.Contexts))
        {
            string id = EnsureLabelIdUnlocked(labelName, commands);
            if (!labelIds.Contains(id, StringComparer.Ordinal))
                labelIds.Add(id);
        }

        string tempTaskId = NewTempId("task");
        string taskUuid = NewUuid();
        string? effectiveDue = preview.Due ?? preview.Scheduled;
        commands.Add(
            new QueuedCommand(
                Uuid: taskUuid,
                TempId: tempTaskId,
                Command: new SyncCommand.TaskAdd(
                    new TaskAddArgs(
                        Title: preview.Title.Trim(),
                        ProjectId: projectId,
                        Description: string.IsNullOrEmpty(description) ? null : description,
                        Priority: QuickCaptureParser.ParseProtocolPriority(preview.Priority),
                        DueDate: effectiveDue,
                        RecurrenceRule: preview.Recurrence,
                        LabelIds: labelIds.Count > 0 ? labelIds : null
                    )
                )
            )
        );

        _snapshot = _cache.EnqueueAndApply(commands, _time.GetUtcNow());
        EmitFeedback(taskUuid, "created", lease, [tempTaskId]);
        return taskUuid;
    }

    private string? ResolveProjectUpdate(
        TaskEditInput input,
        ProtocolTask existing,
        List<QueuedCommand> commands
    )
    {
        if (input.Projects.Count == 0)
        {
            string inboxId =
                _snapshot.Projects.FirstOrDefault(p => !p.IsDeleted && p.IsInbox)?.Id
                ?? string.Empty;
            return inboxId.Length > 0 && inboxId != existing.ProjectId ? inboxId : null;
        }

        string resolved = EnsureProjectIdUnlocked(input.Projects[0], commands);
        return resolved == existing.ProjectId ? null : resolved;
    }

    private List<string>? ResolveLabelsUpdate(
        TaskEditInput input,
        ProtocolTask existing,
        List<QueuedCommand> commands
    )
    {
        List<string> nextIds = [];
        foreach (string token in input.Tags.Concat(input.Contexts))
        {
            string id = EnsureLabelIdUnlocked(token, commands);
            if (!nextIds.Contains(id, StringComparer.Ordinal))
                nextIds.Add(id);
        }

        if (nextIds.SequenceEqual(existing.LabelIds, StringComparer.Ordinal))
            return null;
        return nextIds;
    }

    private string EnsureProjectIdUnlocked(string name, List<QueuedCommand> commands)
    {
        string trimmed = name.Trim();
        Project? existing = _snapshot.Projects.FirstOrDefault(p =>
            !p.IsDeleted && string.Equals(p.Name, trimmed, StringComparison.OrdinalIgnoreCase)
        );
        if (existing is not null)
            return existing.Id;

        QueuedCommand? pending = commands.FirstOrDefault(c =>
            c.Command is SyncCommand.ProjectAdd { Args.Name: var n }
            && string.Equals(n, trimmed, StringComparison.OrdinalIgnoreCase)
        );
        if (pending?.TempId is string pendingId)
            return pendingId;

        string tempId = NewTempId("proj");
        commands.Add(
            new QueuedCommand(
                NewUuid(),
                tempId,
                new SyncCommand.ProjectAdd(
                    new ProjectAddArgs(
                        Name: trimmed,
                        Color: "#808080",
                        ChildOrder: _snapshot.Projects.Count
                    )
                )
            )
        );
        return tempId;
    }

    private string EnsureLabelIdUnlocked(string name, List<QueuedCommand> commands)
    {
        string trimmed = name.Trim();
        Label? existing = _snapshot.Labels.FirstOrDefault(l =>
            !l.IsDeleted && string.Equals(l.Name, trimmed, StringComparison.OrdinalIgnoreCase)
        );
        if (existing is not null)
            return existing.Id;

        QueuedCommand? pending = commands.FirstOrDefault(c =>
            c.Command is SyncCommand.LabelAdd { Args.Name: var n }
            && string.Equals(n, trimmed, StringComparison.OrdinalIgnoreCase)
        );
        if (pending?.TempId is string pendingId)
            return pendingId;

        string tempId = NewTempId("lbl");
        commands.Add(
            new QueuedCommand(
                NewUuid(),
                tempId,
                new SyncCommand.LabelAdd(
                    new LabelAddArgs(
                        Name: trimmed,
                        Color: "#808080",
                        ItemOrder: _snapshot.Labels.Count
                    )
                )
            )
        );
        return tempId;
    }

    private void AppendReminderDiffCommands(
        string taskId,
        JsonElement reminderArray,
        List<QueuedCommand> commands
    )
    {
        Dictionary<string, Reminder> existing = _snapshot
            .Reminders.Where(r => !r.IsDeleted && r.TaskId == taskId)
            .ToDictionary(r => r.Id, StringComparer.Ordinal);
        HashSet<string> retainedIds = new(StringComparer.Ordinal);

        foreach (JsonElement item in reminderArray.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
                continue;
            string id =
                item.TryGetProperty("id", out JsonElement idProp)
                && idProp.ValueKind == JsonValueKind.String
                    ? idProp.GetString()!
                    : string.Empty;
            string type =
                item.TryGetProperty("type", out JsonElement typeProp)
                && typeProp.ValueKind == JsonValueKind.String
                    ? typeProp.GetString()!
                    : "relative";
            int? minuteOffset =
                string.Equals(type, "relative", StringComparison.OrdinalIgnoreCase)
                && item.TryGetProperty("offset", out JsonElement offProp)
                && offProp.ValueKind == JsonValueKind.String
                    ? ParseIsoMinuteOffset(offProp.GetString()!)
                    : null;
            string? absolute =
                string.Equals(type, "absolute", StringComparison.OrdinalIgnoreCase)
                && item.TryGetProperty("absoluteTime", out JsonElement absProp)
                && absProp.ValueKind == JsonValueKind.String
                    ? absProp.GetString()
                    : null;

            if (existing.TryGetValue(id, out Reminder? before))
            {
                retainedIds.Add(id);
                if (
                    !string.Equals(before.ReminderType, type, StringComparison.OrdinalIgnoreCase)
                    || before.MinuteOffset != minuteOffset
                    || !string.Equals(before.DueDatetime, absolute, StringComparison.Ordinal)
                )
                {
                    commands.Add(
                        new QueuedCommand(
                            NewUuid(),
                            null,
                            new SyncCommand.ReminderUpdate(
                                new ReminderUpdateArgs(
                                    Id: id,
                                    ReminderType: type,
                                    MinuteOffset: minuteOffset,
                                    DueDatetime: absolute
                                )
                            )
                        )
                    );
                }
            }
            else
            {
                commands.Add(
                    new QueuedCommand(
                        NewUuid(),
                        NewTempId("rem"),
                        new SyncCommand.ReminderAdd(
                            new ReminderAddArgs(
                                TaskId: taskId,
                                ReminderType: type,
                                MinuteOffset: minuteOffset,
                                DueDatetime: absolute
                            )
                        )
                    )
                );
            }
        }

        foreach (string removedId in existing.Keys.Where(id => !retainedIds.Contains(id)))
        {
            commands.Add(
                new QueuedCommand(
                    NewUuid(),
                    null,
                    new SyncCommand.ReminderDelete(new ReminderDeleteArgs(removedId))
                )
            );
        }
    }

    private static int ParseIsoMinuteOffset(string offset)
    {
        Match match = Regex.Match(
            offset.Trim(),
            @"^(?<sign>-)?PT?(?:(?<h>\d+)H)?(?:(?<m>\d+)M)?$",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant,
            TimeSpan.FromSeconds(1)
        );
        if (!match.Success)
            return -15;
        int hours = match.Groups["h"].Success
            ? int.Parse(match.Groups["h"].Value, CultureInfo.InvariantCulture)
            : 0;
        int mins = match.Groups["m"].Success
            ? int.Parse(match.Groups["m"].Value, CultureInfo.InvariantCulture)
            : 0;
        int total = hours * 60 + mins;
        return match.Groups["sign"].Success ? -total : total;
    }

    private void RecordUndoSnapshot(string receiptId, IReadOnlyList<ProtocolTask> originals)
    {
        UndoTaskState[] states = originals
            .Select(t => new UndoTaskState(
                t.Id,
                t.Completed,
                t.CompletedAt,
                t.DueDate,
                t.RecurrenceRule
            ))
            .ToArray();
        _undoStack.Add(new UndoBatchEntry(receiptId, states));
        if (_undoStack.Count > 32)
            _undoStack.RemoveAt(0);
    }

    private void RemapUndoStack(IReadOnlyDictionary<string, string> mapping)
    {
        for (int i = 0; i < _undoStack.Count; i++)
        {
            UndoBatchEntry batch = _undoStack[i];
            UndoTaskState[] remapped = batch
                .Tasks.Select(item =>
                    mapping.TryGetValue(item.TaskId, out string? realId)
                        ? item with
                        {
                            TaskId = realId,
                        }
                        : item
                )
                .ToArray();
            _undoStack[i] = batch with { Tasks = remapped };
        }
    }

    private void EmitFeedback(
        string mutationId,
        string eventKind,
        FacetFeedbackLease? lease,
        IReadOnlyList<string> paths
    )
    {
        long gen = Interlocked.Read(ref _feedbackGeneration);
        FacetNoticeOwner owner = new("default", mutationId, 1, gen);
        AppliedFeedback?.Invoke(
            new FacetAppliedFeedback(
                EngineSessionId: _feedbackSessionId,
                Owner: owner,
                Event: eventKind,
                Changed: true,
                OwnsAdmission: true,
                LifecycleGeneration: gen,
                Origin: lease,
                Paths: paths
            )
        );
    }

    private ProtocolTask RequireProtocolTask(string taskId) =>
        _snapshot.Tasks.FirstOrDefault(t => !t.IsDeleted && t.Id == taskId)
        ?? throw new FacetValidationException($"Task '{taskId}' no longer exists.");

    private Filter RequireFilter(string viewId) =>
        _snapshot.Filters.FirstOrDefault(f => !f.IsDeleted && f.Id == viewId)
        ?? throw new FacetValidationException($"Saved view '{viewId}' no longer exists.");

    private static SavedViewDefinition MapSavedView(Filter filter, int fallbackOrder)
    {
        SavedFilterPayload parsed = ParseFilterQuery(filter.Query);
        string filterJson = JsonSerializer.Serialize(parsed.Query);
        return new SavedViewDefinition
        {
            Id = filter.Id,
            Name = filter.Name,
            Symbol = parsed.Symbol,
            Tint = string.IsNullOrWhiteSpace(filter.Color) ? parsed.Tint : filter.Color,
            IsFavorite = filter.IsFavorite,
            Order = (int)filter.ItemOrder >= 0 ? (int)filter.ItemOrder : fallbackOrder,
            FilterJson = filterJson,
            SortJson = null,
            Group = parsed.Query.Group,
        };
    }

    private static string SerializeSavedFilterPayload(
        TaskListQuery query,
        string symbol,
        string tint
    ) =>
        JsonSerializer.Serialize(
            new SavedFilterPayload(
                query,
                string.IsNullOrWhiteSpace(symbol) ? "Filter" : symbol,
                string.IsNullOrWhiteSpace(tint) ? "Accent" : tint
            )
        );

    private static SavedFilterPayload ParseFilterQuery(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return new SavedFilterPayload(new TaskListQuery(TaskListKind.Browse));
        try
        {
            using JsonDocument doc = JsonDocument.Parse(raw);
            if (doc.RootElement.ValueKind == JsonValueKind.Object)
            {
                if (doc.RootElement.TryGetProperty("Query", out _))
                {
                    SavedFilterPayload? wrapped = JsonSerializer.Deserialize<SavedFilterPayload>(
                        raw
                    );
                    if (wrapped?.Query is not null)
                        return wrapped;
                }
                TaskListQuery? direct = JsonSerializer.Deserialize<TaskListQuery>(raw);
                if (direct is not null)
                    return new SavedFilterPayload(direct);
            }
        }
        catch (JsonException)
        {
            // Plain search query authored by another client falls back to Browse search.
        }
        return new SavedFilterPayload(
            new TaskListQuery(TaskListKind.Browse) { Search = raw.Trim() }
        );
    }

    private static TaskListQuery ResolveEffectiveQuery(
        TaskListQuery query,
        IReadOnlyList<SavedViewDefinition> savedViews
    )
    {
        if (query.Kind != TaskListKind.SavedView || string.IsNullOrWhiteSpace(query.Scope))
            return query;
        SavedViewDefinition? view = savedViews.FirstOrDefault(v => v.Id == query.Scope);
        if (view is null)
            return new TaskListQuery(TaskListKind.Browse);
        TaskListQuery baseQuery = ParseFilterQuery(view.FilterJson).Query;
        return baseQuery with
        {
            Search = string.IsNullOrWhiteSpace(query.Search) ? baseQuery.Search : query.Search,
            Group = query.Group != TaskGroupChoice.None ? query.Group : view.Group,
        };
    }

    private static string? NullIfBlank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string NewUuid() => Guid.NewGuid().ToString("D");

    private static string NewTempId(string prefix) => $"tmp-{prefix}-{Guid.NewGuid():N}";
}
