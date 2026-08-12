using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Core = uniffi.TaskNotesCore;
using CoreTask = uniffi.TaskNotesCore.Task;

namespace TaskNotes.Windows.Host
{
    /// <summary>Serializes all UniFFI calls and publishes native UI projections.</summary>
    public sealed partial class TaskNotesStore : ITaskNotesStore
    {
        private readonly EngineRunner _runner;
        private readonly CoalescingTaskPump _drainPump;
        private readonly FileHostStorage _storage;
        private readonly SavedViewCatalog _savedViews;
        private readonly TaskProjectionService _projections;
        private readonly SystemClock _clock;
        private readonly CryptographicRandomness _randomness;
        private readonly RetryTimerScheduler _scheduler;
        private readonly ILogger<TaskNotesStore> _logger;
        private readonly CompletionUndoCoordinator _completionUndo = new();
        private Core.FfiSyncEngine? _engine;
        private Core.TaskNotesApi? _api;
        private BearerHttpTransport? _transport;
        private TaskListQuery _query = TaskListQuery.Today;
        private TaskTimeReading? _taskTime;
        private TimeReportReading? _timeReport;
        private PomodoroReading? _pomodoro;
        private bool _configured;
        private bool _disposed;

        /// <summary>Initializes a store rooted at the application-local data directory.</summary>
        public TaskNotesStore(string storageDirectory, ILogger<TaskNotesStore>? logger = null)
        {
            _runner = new EngineRunner();
            _storage = new FileHostStorage(storageDirectory);
            _savedViews = new SavedViewCatalog(new SavedViewStorage(_storage));
            _projections = new TaskProjectionService(_savedViews.Require);
            _clock = new SystemClock();
            _randomness = new CryptographicRandomness();
            _scheduler = new RetryTimerScheduler();
            _logger = logger ?? NullLogger<TaskNotesStore>.Instance;
            _drainPump = new CoalescingTaskPump(DrainAndPublishAsync);
            _scheduler.Bind(OnRetryTimerAsync);
        }

        /// <summary>Occurs after a new immutable state reading is published.</summary>
        public event EventHandler? StateChanged;

        /// <summary>Gets the latest immutable engine reading.</summary>
        public TaskNotesState State { get; private set; } = TaskNotesState.Unconfigured;

        /// <summary>Restores cached state, installs the requested server, and synchronizes when configured.</summary>
        public async Task InitializeAsync(
            string? serverUrl,
            string? token,
            CancellationToken cancellationToken = default
        )
        {
            ThrowIfDisposed();
            await PublishAsync(
                    State with
                    {
                        SyncState = TaskNotesSyncState.Loading,
                        UserFacingError = null,
                    }
                )
                .ConfigureAwait(false);
            TaskNotesState cached = await _runner
                .RunAsync(() => ConfigureAndRestore(serverUrl, token), cancellationToken)
                .ConfigureAwait(false);
            await PublishAsync(cached).ConfigureAwait(false);
            if (_configured)
            {
                await RefreshAsync(cancellationToken).ConfigureAwait(false);
            }
        }

        /// <summary>Replaces the current engine with one bound to a new server and token.</summary>
        public Task ReconfigureAsync(
            string? serverUrl,
            string? token,
            CancellationToken cancellationToken = default
        )
        {
            return InitializeAsync(serverUrl, token, cancellationToken);
        }

        /// <summary>Runs an explicit synchronization pass.</summary>
        public async Task RefreshAsync(CancellationToken cancellationToken = default)
        {
            ThrowIfDisposed();
            TaskNotesState state = await _runner
                .RunAsync(SyncAndObserve, cancellationToken)
                .ConfigureAwait(false);
            await PublishAsync(state).ConfigureAwait(false);
        }

        /// <summary>Selects a fixed, dynamic, saved-view, or board task projection.</summary>
        public async Task SetQueryAsync(
            TaskListQuery query,
            CancellationToken cancellationToken = default
        )
        {
            ThrowIfDisposed();
            ArgumentNullException.ThrowIfNull(query);
            TaskNotesState state = await _runner
                .RunAsync(
                    () =>
                    {
                        TaskListQuery previous = _query;
                        _query = query;
                        try
                        {
                            return Observe();
                        }
                        catch
                        {
                            _query = previous;
                            throw;
                        }
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
            await PublishAsync(state).ConfigureAwait(false);
        }

        /// <summary>Parses Quick Add input through the Rust core without mutating state.</summary>
        public Task<QuickAddPreview> PreviewQuickAddAsync(
            string input,
            CancellationToken cancellationToken = default
        )
        {
            ThrowIfDisposed();
            ArgumentException.ThrowIfNullOrWhiteSpace(input);
            return _runner.RunAsync(() => PreviewQuickAdd(input, _query), cancellationToken);
        }

        /// <summary>Parses and queues a Today quick-add task through the Rust core.</summary>
        public Task AddAsync(string input, CancellationToken cancellationToken = default)
        {
            return AddAsync(input, TaskListQuery.Today, cancellationToken);
        }

        /// <summary>Parses and queues a contextual quick-add task through the Rust core.</summary>
        public async Task AddAsync(
            string input,
            TaskListQuery context,
            CancellationToken cancellationToken = default
        )
        {
            ThrowIfDisposed();
            ArgumentException.ThrowIfNullOrWhiteSpace(input);
            ArgumentNullException.ThrowIfNull(context);
            TaskNotesState state = await _runner
                .RunAsync(() => AddAndObserve(input, context), cancellationToken)
                .ConfigureAwait(false);
            await PublishAsync(state).ConfigureAwait(false);
            _drainPump.Request();
        }

        /// <summary>Applies every editable task field as one core update command.</summary>
        public async Task UpdateTaskAsync(
            TaskEditInput input,
            CancellationToken cancellationToken = default
        )
        {
            ThrowIfDisposed();
            ArgumentNullException.ThrowIfNull(input);
            TaskNotesState state = await _runner
                .RunAsync(() => UpdateTaskAndObserve(input), cancellationToken)
                .ConfigureAwait(false);
            await PublishAsync(state).ConfigureAwait(false);
            _drainPump.Request();
        }

        /// <summary>Queues deletion of one task.</summary>
        public async Task DeleteTaskAsync(
            string taskId,
            CancellationToken cancellationToken = default
        )
        {
            ThrowIfDisposed();
            ArgumentException.ThrowIfNullOrWhiteSpace(taskId);
            TaskNotesState state = await _runner
                .RunAsync(
                    () =>
                    {
                        _ = RequireEngine().Dispatch(new Core.CommandInput.Delete(taskId));
                        return Observe();
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
            await PublishAsync(state).ConfigureAwait(false);
            _drainPump.Request();
        }

        /// <summary>Sets a task to an absolute status through the core queue.</summary>
        public async Task SetStatusAsync(
            string taskId,
            string status,
            CancellationToken cancellationToken = default
        )
        {
            ThrowIfDisposed();
            ArgumentException.ThrowIfNullOrWhiteSpace(taskId);
            ArgumentException.ThrowIfNullOrWhiteSpace(status);
            TaskNotesState state = await _runner
                .RunAsync(
                    () =>
                    {
                        Core.TaskStatus parsed = Core.TaskNotesCoreMethods.TaskStatusParse(status);
                        _ = RequireEngine()
                            .Dispatch(new Core.CommandInput.SetStatus(taskId, parsed));
                        return Observe();
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
            await PublishAsync(state).ConfigureAwait(false);
            _drainPump.Request();
        }

        /// <summary>Sets a task or recurring occurrence to an absolute completion state.</summary>
        public async Task SetCompletionAsync(
            string taskId,
            bool completed,
            CancellationToken cancellationToken = default
        )
        {
            ThrowIfDisposed();
            ArgumentException.ThrowIfNullOrWhiteSpace(taskId);
            TaskNotesState state = await _runner
                .RunAsync(
                    () =>
                    {
                        CompletionRestore? restore = DispatchCompletion(taskId, completed, null);
                        if (restore is not null)
                        {
                            _completionUndo.Push("Completed task", [restore]);
                        }
                        return Observe();
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
            await PublishAsync(state).ConfigureAwait(false);
            _drainPump.Request();
        }

        /// <summary>Completes all requested tasks and records one grouped undo entry.</summary>
        public async Task CompleteTasksAsync(
            IReadOnlyList<string> taskIds,
            CancellationToken cancellationToken = default
        )
        {
            ThrowIfDisposed();
            ArgumentNullException.ThrowIfNull(taskIds);
            TaskNotesState state = await _runner
                .RunAsync(
                    () =>
                    {
                        List<CompletionRestore> restores = [];
                        foreach (string taskId in DistinctIds(taskIds))
                        {
                            CompletionRestore? restore = DispatchCompletion(taskId, true, null);
                            if (restore is not null)
                            {
                                restores.Add(restore);
                            }
                        }
                        if (restores.Count > 0)
                        {
                            _completionUndo.Push($"Completed {restores.Count} tasks", restores);
                        }
                        return Observe();
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
            await PublishAsync(state).ConfigureAwait(false);
            _drainPump.Request();
        }

        /// <summary>Restores the most recent successful completion or grouped completion.</summary>
        public async Task UndoCompletionAsync(CancellationToken cancellationToken = default)
        {
            ThrowIfDisposed();
            TaskNotesState state = await _runner
                .RunAsync(
                    () =>
                    {
                        _completionUndo.Undo(command =>
                        {
                            _ = RequireEngine().Dispatch(command);
                        });
                        return Observe();
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
            await PublishAsync(state).ConfigureAwait(false);
            _drainPump.Request();
        }

        /// <summary>Schedules all requested tasks to one value, or clears their schedule.</summary>
        public Task ScheduleTasksAsync(
            IReadOnlyList<string> taskIds,
            string? scheduled,
            CancellationToken cancellationToken = default
        )
        {
            Core.TextUpdate update = string.IsNullOrWhiteSpace(scheduled)
                ? new Core.TextUpdate.Clear()
                : new Core.TextUpdate.Set(scheduled.Trim());
            return UpdateManyAsync(
                taskIds,
                request => request with { Scheduled = update },
                cancellationToken
            );
        }

        /// <summary>Sets one priority on all requested tasks.</summary>
        public Task PrioritizeTasksAsync(
            IReadOnlyList<string> taskIds,
            string priority,
            CancellationToken cancellationToken = default
        )
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(priority);
            return UpdateManyAsync(
                taskIds,
                request =>
                    request with
                    {
                        Priority = Core.TaskNotesCoreMethods.PriorityParse(priority),
                    },
                cancellationToken
            );
        }

        /// <summary>Queues deletion of all requested tasks.</summary>
        public async Task DeleteTasksAsync(
            IReadOnlyList<string> taskIds,
            CancellationToken cancellationToken = default
        )
        {
            ThrowIfDisposed();
            ArgumentNullException.ThrowIfNull(taskIds);
            TaskNotesState state = await _runner
                .RunAsync(
                    () =>
                    {
                        foreach (string taskId in DistinctIds(taskIds))
                        {
                            _ = RequireEngine().Dispatch(new Core.CommandInput.Delete(taskId));
                        }
                        return Observe();
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
            await PublishAsync(state).ConfigureAwait(false);
            _drainPump.Request();
        }

        /// <summary>Reads live timing totals for one task.</summary>
        public Task LoadTaskTimeAsync(string taskId, CancellationToken cancellationToken = default)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(taskId);
            return RunLiveAsync(
                () =>
                {
                    Core.TaskTime reading = RequireApi().TaskTime(taskId);
                    _taskTime = new TaskTimeReading(
                        taskId,
                        reading.TotalTime,
                        reading.HasActiveSession
                    );
                    return Observe();
                },
                cancellationToken
            );
        }

        /// <summary>Starts live server-backed time tracking for one task.</summary>
        public Task StartTimeTrackingAsync(
            string taskId,
            CancellationToken cancellationToken = default
        )
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(taskId);
            return MutateTimeAsync(taskId, api => api.StartTimeTracking(taskId), cancellationToken);
        }

        /// <summary>Stops live server-backed time tracking for one task.</summary>
        public Task StopTimeTrackingAsync(
            string taskId,
            CancellationToken cancellationToken = default
        )
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(taskId);
            return MutateTimeAsync(taskId, api => api.StopTimeTracking(taskId), cancellationToken);
        }

        /// <summary>Loads the aggregate server-backed time report.</summary>
        public Task LoadTimeReportAsync(
            string period = "all",
            CancellationToken cancellationToken = default
        )
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(period);
            return RunLiveAsync(
                () =>
                {
                    Core.TimeSummary report = RequireApi().TimeSummary(period);
                    _timeReport = new TimeReportReading(
                        report.TotalTime,
                        [
                            .. report.TopTasks.Select(row => new TimeReportRow(
                                row.TaskId,
                                row.Title,
                                row.Minutes
                            )),
                        ]
                    );
                    return Observe();
                },
                cancellationToken
            );
        }

        /// <summary>Loads the current server-backed Pomodoro state.</summary>
        public Task LoadPomodoroAsync(CancellationToken cancellationToken = default)
        {
            return MutatePomodoroAsync(api => api.PomodoroStatus(), cancellationToken);
        }

        /// <summary>Starts a server-backed Pomodoro interval.</summary>
        public Task StartPomodoroAsync(
            string? taskId,
            CancellationToken cancellationToken = default
        )
        {
            return MutatePomodoroAsync(api => api.StartPomodoro(taskId), cancellationToken);
        }

        /// <summary>Toggles the server-backed Pomodoro interval between running and paused.</summary>
        public Task PauseOrResumePomodoroAsync(CancellationToken cancellationToken = default)
        {
            return MutatePomodoroAsync(api => api.PausePomodoro(), cancellationToken);
        }

        /// <summary>Stops the server-backed Pomodoro interval.</summary>
        public Task StopPomodoroAsync(CancellationToken cancellationToken = default)
        {
            return MutatePomodoroAsync(api => api.StopPomodoro(), cancellationToken);
        }

        /// <summary>Creates a saved view from the supplied query.</summary>
        public async Task<SavedViewDefinition> CreateSavedViewAsync(
            string name,
            string symbol,
            string tint,
            bool favorite,
            TaskListQuery query,
            CancellationToken cancellationToken = default
        )
        {
            ThrowIfDisposed();
            ArgumentException.ThrowIfNullOrWhiteSpace(name);
            SavedViewDefinition view = await _runner
                .RunAsync(
                    () =>
                    {
                        return _savedViews.Create(name, symbol, tint, favorite, query);
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
            await PublishObservedAsync(cancellationToken).ConfigureAwait(false);
            return view;
        }

        /// <summary>Replaces one saved view after validating its core documents.</summary>
        public async Task UpdateSavedViewAsync(
            SavedViewDefinition view,
            CancellationToken cancellationToken = default
        )
        {
            ThrowIfDisposed();
            ArgumentNullException.ThrowIfNull(view);
            _ = await _runner
                .RunAsync(
                    () =>
                    {
                        _savedViews.Update(view);
                        return true;
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
            await PublishObservedAsync(cancellationToken).ConfigureAwait(false);
        }

        /// <summary>Duplicates one saved view and returns the copy.</summary>
        public async Task<SavedViewDefinition> DuplicateSavedViewAsync(
            string viewId,
            CancellationToken cancellationToken = default
        )
        {
            ThrowIfDisposed();
            SavedViewDefinition copy = await _runner
                .RunAsync(
                    () =>
                    {
                        return _savedViews.Duplicate(viewId);
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
            await PublishObservedAsync(cancellationToken).ConfigureAwait(false);
            return copy;
        }

        /// <summary>Deletes one device-local saved view.</summary>
        public async Task DeleteSavedViewAsync(
            string viewId,
            CancellationToken cancellationToken = default
        )
        {
            ThrowIfDisposed();
            _ = await _runner
                .RunAsync(
                    () =>
                    {
                        _savedViews.Delete(viewId);
                        if (
                            _query.Kind == TaskListKind.SavedView
                            && string.Equals(_query.Scope, viewId, StringComparison.Ordinal)
                        )
                        {
                            _query = new TaskListQuery(TaskListKind.Browse);
                        }
                        return true;
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
            await PublishObservedAsync(cancellationToken).ConfigureAwait(false);
        }

        /// <summary>Moves one saved view to a new zero-based position.</summary>
        public async Task MoveSavedViewAsync(
            string viewId,
            int index,
            CancellationToken cancellationToken = default
        )
        {
            ThrowIfDisposed();
            _ = await _runner
                .RunAsync(
                    () =>
                    {
                        _savedViews.Move(viewId, index);
                        return true;
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
            await PublishObservedAsync(cancellationToken).ConfigureAwait(false);
        }

        /// <summary>Restores the two editable default saved views.</summary>
        public async Task RestoreDefaultSavedViewsAsync(
            CancellationToken cancellationToken = default
        )
        {
            ThrowIfDisposed();
            _ = await _runner
                .RunAsync(
                    () =>
                    {
                        _savedViews.RestoreDefaults();
                        return true;
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
            await PublishObservedAsync(cancellationToken).ConfigureAwait(false);
        }

        /// <summary>Returns a parked mutation to the core's durable queue.</summary>
        public async Task RetryParkedMutationAsync(
            string mutationId,
            CancellationToken cancellationToken = default
        )
        {
            ThrowIfDisposed();
            ArgumentException.ThrowIfNullOrWhiteSpace(mutationId);
            TaskNotesState state = await _runner
                .RunAsync(
                    () =>
                    {
                        RequireEngine().RetryDeadLetter(mutationId);
                        return Observe();
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
            await PublishAsync(state).ConfigureAwait(false);
            _drainPump.Request();
        }

        /// <summary>Permanently discards a parked mutation.</summary>
        public async Task DiscardParkedMutationAsync(
            string mutationId,
            CancellationToken cancellationToken = default
        )
        {
            ThrowIfDisposed();
            ArgumentException.ThrowIfNullOrWhiteSpace(mutationId);
            TaskNotesState state = await _runner
                .RunAsync(
                    () =>
                    {
                        RequireEngine().DiscardDeadLetter(mutationId);
                        return Observe();
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
            await PublishAsync(state).ConfigureAwait(false);
        }

        /// <summary>Cancels transport work and retires the native engine.</summary>
        public async ValueTask DisposeAsync()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _transport?.CancelAll();
            await _drainPump.DisposeAsync().ConfigureAwait(false);
            _ = await _runner
                .RunAsync(() =>
                {
                    RetireEngine();
                    return true;
                })
                .ConfigureAwait(false);
            await _scheduler.DisposeAsync().ConfigureAwait(false);
            await _runner.DisposeAsync().ConfigureAwait(false);
        }

        private TaskNotesState ConfigureAndRestore(string? serverUrl, string? token)
        {
            RetireEngine();
            bool hasUrl = !string.IsNullOrWhiteSpace(serverUrl);
            bool hasToken = !string.IsNullOrWhiteSpace(token);
            if (!hasUrl && hasToken)
            {
                throw new Core.CoreException.Validation(
                    "A server URL is required when a token is provided."
                );
            }

            _configured = hasUrl;
            if (hasUrl && serverUrl is not null)
            {
                _transport = new BearerHttpTransport(token);
                _api = new Core.TaskNotesApi(
                    _transport,
                    serverUrl,
                    Core.TaskNotesCoreMethods.ApiDefaultTimeoutMillis()
                );
            }

            Core.FfiSyncEngine replacement = new(
                _api,
                _storage,
                _storage,
                _clock,
                _scheduler,
                _randomness,
                true
            );
            try
            {
                replacement.Restore();
                _savedViews.LoadOrCreateDefaults();
                _engine = replacement;
            }
            catch
            {
                replacement.Shutdown();
                replacement.Dispose();
                throw;
            }

            return Observe();
        }

        private TaskNotesState SyncAndObserve()
        {
            Core.FfiSyncEngine engine = RequireEngine();
            try
            {
                engine.SyncNow();
            }
            catch (Core.CoreException)
            {
                // The engine records every synchronization failure in Status().
            }
            return Observe();
        }

        private QuickAddPreview PreviewQuickAdd(string input, TaskListQuery context)
        {
            Core.NlpParseResult parsed = Core.TaskNotesCoreMethods.ParseTaskInput(input, Today());
            var defaults = TaskProjectionService.QuickAddDefaults(context, Today());
            return new QuickAddPreview(
                parsed.Title,
                parsed.Due ?? defaults.Due,
                Core.TaskNotesCoreMethods.PriorityWireValue(
                    parsed.Priority ?? Core.Priority.Normal
                ),
                Merge(parsed.Projects, defaults.Projects),
                Merge(parsed.Contexts, defaults.Contexts),
                Merge(parsed.Tags, defaults.Tags),
                parsed.Recurrence
            );
        }

        private TaskNotesState AddAndObserve(string input, TaskListQuery context)
        {
            Core.FfiSyncEngine engine = RequireEngine();
            QuickAddPreview preview = PreviewQuickAdd(input, context);
            Core.CreateTaskRequest request = new(
                preview.Title,
                null,
                null,
                Core.TaskNotesCoreMethods.PriorityParse(preview.Priority),
                preview.Due,
                null,
                [.. preview.Contexts],
                [.. preview.Projects],
                [.. preview.Tags],
                preview.Recurrence,
                null,
                null,
                null
            );
            _ = engine.Dispatch(new Core.CommandInput.Create(request));
            return Observe();
        }

        private TaskNotesState UpdateTaskAndObserve(TaskEditInput input)
        {
            Core.FfiSyncEngine engine = RequireEngine();
            CoreTask task = FindTask(engine, input.Id);
            string title = input.Title.Trim();
            if (title.Length == 0)
            {
                throw new Core.CoreException.Validation("A task title is required.");
            }

            Core.UpdateTaskRequest request = EmptyUpdate() with
            {
                Title = string.Equals(task.Title, title, StringComparison.Ordinal) ? null : title,
                Details = TextUpdate(task.Details, input.Details, trim: false),
                Status = ParseChangedStatus(task, input.Status),
                Priority = ParseChangedPriority(task, input.Priority),
                Due = TextUpdate(task.Due, input.Due, trim: true),
                Scheduled = TextUpdate(task.Scheduled, input.Scheduled, trim: true),
                Contexts = SequenceEqual(task.Contexts, input.Contexts)
                    ? null
                    : Normalize(input.Contexts),
                Projects = SequenceEqual(task.Projects, input.Projects)
                    ? null
                    : Normalize(input.Projects),
                Tags = SequenceEqual(task.Tags, input.Tags) ? null : Normalize(input.Tags),
                Recurrence = TextUpdate(task.Recurrence, input.Recurrence, trim: true),
                RecurrenceAnchor = RecurrenceAnchorUpdate(
                    task.RecurrenceAnchor,
                    input.RecurrenceAnchor
                ),
                TimeEstimate = MinutesUpdate(task.TimeEstimate, input.TimeEstimate),
            };
            _ = engine.Dispatch(new Core.CommandInput.Update(task.Id, request));
            return Observe();
        }

        private CompletionRestore? DispatchCompletion(
            string taskId,
            bool completed,
            string? occurrenceDate
        )
        {
            Core.FfiSyncEngine engine = RequireEngine();
            CoreTask task = FindTask(engine, taskId);
            if (!string.IsNullOrWhiteSpace(task.Recurrence))
            {
                string target =
                    occurrenceDate
                    ?? Core.TaskNotesCoreMethods.RecurrenceCompletionTargetDate(
                        task.Scheduled,
                        task.Due,
                        task.RecurrenceAnchor,
                        Today()
                    );
                bool alreadyCompleted = task.CompleteInstances.Contains(
                    target,
                    StringComparer.Ordinal
                );
                if (alreadyCompleted == completed)
                {
                    return null;
                }
                _ = engine.Dispatch(
                    new Core.CommandInput.SetInstanceComplete(task.Id, target, completed)
                );
                return completed ? new CompletionRestore(task.Id, null, target) : null;
            }

            bool isCompleted = !Core.TaskNotesCoreMethods.TaskStatusIsActive(task.Status);
            if (isCompleted == completed)
            {
                return null;
            }
            Core.TaskStatus targetStatus = completed ? Core.TaskStatus.Done : Core.TaskStatus.Open;
            _ = engine.Dispatch(new Core.CommandInput.SetStatus(task.Id, targetStatus));
            return completed ? new CompletionRestore(task.Id, task.Status, null) : null;
        }

        private async Task UpdateManyAsync(
            IReadOnlyList<string> taskIds,
            Func<Core.UpdateTaskRequest, Core.UpdateTaskRequest> update,
            CancellationToken cancellationToken
        )
        {
            ThrowIfDisposed();
            ArgumentNullException.ThrowIfNull(taskIds);
            TaskNotesState state = await _runner
                .RunAsync(
                    () =>
                    {
                        foreach (string taskId in DistinctIds(taskIds))
                        {
                            _ = RequireEngine()
                                .Dispatch(
                                    new Core.CommandInput.Update(taskId, update(EmptyUpdate()))
                                );
                        }
                        return Observe();
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
            await PublishAsync(state).ConfigureAwait(false);
            _drainPump.Request();
        }

        private async Task MutateTimeAsync(
            string taskId,
            Func<Core.TaskNotesApi, CoreTask> mutation,
            CancellationToken cancellationToken
        )
        {
            await RunLiveAsync(
                    () =>
                    {
                        _ = mutation(RequireApi());
                        Core.TaskTime reading = RequireApi().TaskTime(taskId);
                        _taskTime = new TaskTimeReading(
                            taskId,
                            reading.TotalTime,
                            reading.HasActiveSession
                        );
                        RequireEngine().SyncNow();
                        return Observe();
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
        }

        private Task MutatePomodoroAsync(
            Func<Core.TaskNotesApi, Core.PomodoroStatus> operation,
            CancellationToken cancellationToken
        )
        {
            return RunLiveAsync(
                () =>
                {
                    Core.PomodoroStatus status = operation(RequireApi());
                    _pomodoro = ProjectPomodoro(status);
                    return Observe();
                },
                cancellationToken
            );
        }

        private async Task RunLiveAsync(
            Func<TaskNotesState> operation,
            CancellationToken cancellationToken
        )
        {
            ThrowIfDisposed();
            try
            {
                TaskNotesState state = await _runner
                    .RunAsync(operation, cancellationToken)
                    .ConfigureAwait(false);
                await PublishAsync(state with { UserFacingError = null }).ConfigureAwait(false);
            }
            catch (Core.CoreException exception)
            {
                await PublishAsync(
                        State with
                        {
                            SyncState = LiveFailureState(exception),
                            UserFacingError = ErrorMessage(exception),
                        }
                    )
                    .ConfigureAwait(false);
                throw;
            }
        }

        private TaskNotesState Observe()
        {
            Core.FfiSyncEngine engine = RequireEngine();
            Core.TaskStoreSnapshot snapshot = engine.Snapshot();
            Core.SyncStatus status = engine.Status();
            string today = Today();
            HashSet<string> pending = new(snapshot.PendingTaskIds, StringComparer.Ordinal);
            TaskProjection visible = _projections.ProjectTasks(
                snapshot.Tasks,
                _query,
                today,
                pending
            );
            TaskProjection all = _projections.ProjectTasks(
                snapshot.Tasks,
                new TaskListQuery(TaskListKind.Browse),
                today,
                pending
            );
            TaskProjection todayProjection = _projections.ProjectTasks(
                snapshot.Tasks,
                TaskListQuery.Today,
                today,
                pending
            );

            TodayTask[] todayTasks =
            [
                .. todayProjection.Tasks.Select(task => new TodayTask(
                    task.Id,
                    task.Title,
                    task.Due,
                    task.Scheduled,
                    task.IsCompleted,
                    task.IsRecurring,
                    task.IsPending
                )),
            ];
            ParkedChange[] parked =
            [
                .. snapshot.DeadLetters.Select(entry => new ParkedChange(
                    CommandId(entry.Command),
                    entry.Error.Name,
                    entry.Error.Message,
                    entry.Error.Status,
                    DateTimeOffset.FromUnixTimeMilliseconds(entry.FailedAt)
                )),
            ];
            string? error = status.LastError is null ? null : ErrorMessage(status.LastError);

            return new TaskNotesState(
                todayTasks,
                pending,
                snapshot.PendingCount,
                parked,
                MapState(status.State),
                error,
                snapshot.LastSyncTime is long millis
                    ? DateTimeOffset.FromUnixTimeMilliseconds(millis)
                    : null
            )
            {
                AllTasks = all.Tasks,
                VisibleTasks = visible.Tasks,
                Query = _query,
                Projects = TaskProjectionService.Taxonomy(
                    snapshot.Tasks.SelectMany(task => task.Projects),
                    project: true
                ),
                Contexts = TaskProjectionService.Taxonomy(
                    snapshot.Tasks.SelectMany(task => task.Contexts),
                    project: false
                ),
                Tags = TaskProjectionService.Taxonomy(
                    snapshot.Tasks.SelectMany(task => task.Tags),
                    project: false
                ),
                SavedViews = _savedViews.Presentation,
                TaskTime = _taskTime,
                TimeReport = _timeReport,
                Pomodoro = _pomodoro,
                CanUndoCompletion = _completionUndo.CanUndo,
                CompletionUndoDepth = _completionUndo.Depth,
            };
        }

        private static Core.UpdateTaskRequest EmptyUpdate()
        {
            return new Core.UpdateTaskRequest(
                null,
                new Core.TextUpdate.Unchanged(),
                null,
                null,
                new Core.TextUpdate.Unchanged(),
                new Core.TextUpdate.Unchanged(),
                null,
                null,
                null,
                new Core.TextUpdate.Unchanged(),
                new Core.RecurrenceAnchorUpdate.Unchanged(),
                new Core.MinutesUpdate.Unchanged(),
                null
            );
        }

        private static Core.TextUpdate TextUpdate(string? current, string? requested, bool trim)
        {
            string? normalized = requested;
            if (trim && normalized is not null)
            {
                normalized = normalized.Trim();
            }
            if (string.IsNullOrEmpty(normalized))
            {
                normalized = null;
            }
            return string.Equals(current, normalized, StringComparison.Ordinal)
                    ? new Core.TextUpdate.Unchanged()
                : normalized is null ? new Core.TextUpdate.Clear()
                : new Core.TextUpdate.Set(normalized);
        }

        private static Core.RecurrenceAnchorUpdate RecurrenceAnchorUpdate(
            Core.RecurrenceAnchor? current,
            string? requested
        )
        {
            Core.RecurrenceAnchor? desired = string.IsNullOrWhiteSpace(requested)
                ? null
                : Core.TaskNotesCoreMethods.RecurrenceAnchorParse(requested.Trim());
            return current == desired ? new Core.RecurrenceAnchorUpdate.Unchanged()
                : desired is Core.RecurrenceAnchor value
                    ? new Core.RecurrenceAnchorUpdate.Set(value)
                : new Core.RecurrenceAnchorUpdate.Clear();
        }

        private static Core.MinutesUpdate MinutesUpdate(uint? current, uint? requested)
        {
            return current == requested ? new Core.MinutesUpdate.Unchanged()
                : requested is uint value ? new Core.MinutesUpdate.Set(value)
                : new Core.MinutesUpdate.Clear();
        }

        private static Core.TaskStatus? ParseChangedStatus(CoreTask task, string requested)
        {
            Core.TaskStatus status = Core.TaskNotesCoreMethods.TaskStatusParse(requested);
            return task.Status == status ? null : status;
        }

        private static Core.Priority? ParseChangedPriority(CoreTask task, string requested)
        {
            Core.Priority priority = Core.TaskNotesCoreMethods.PriorityParse(requested);
            return task.Priority == priority ? null : priority;
        }

        private static bool SequenceEqual(IReadOnlyList<string> left, IReadOnlyList<string> right)
        {
            return left.SequenceEqual(Normalize(right), StringComparer.Ordinal);
        }

        private static string[] Normalize(IEnumerable<string> values)
        {
            return
            [
                .. values
                    .Select(value => value.Trim())
                    .Where(value => value.Length > 0)
                    .Distinct(StringComparer.Ordinal),
            ];
        }

        private static string[] Merge(IEnumerable<string>? values, IEnumerable<string> defaults)
        {
            return Normalize((values ?? []).Concat(defaults));
        }

        private static string[] DistinctIds(IEnumerable<string> taskIds)
        {
            string[] ids = Normalize(taskIds);
            return ids.Length == 0
                ? throw new Core.CoreException.Validation("At least one task is required.")
                : ids;
        }

        private static CoreTask FindTask(Core.FfiSyncEngine engine, string taskId)
        {
            return engine
                .Snapshot()
                .Tasks.Single(item => string.Equals(item.Id, taskId, StringComparison.Ordinal));
        }

        private static PomodoroReading ProjectPomodoro(Core.PomodoroStatus status)
        {
            string? phase = status.Phase switch
            {
                null => null,
                Core.PomodoroPhase.Work => "work",
                Core.PomodoroPhase.Break => "break",
                _ => throw new InvalidOperationException($"Unknown Pomodoro phase {status.Phase}."),
            };
            return new PomodoroReading(status.Active, status.TaskId, status.TimeRemaining, phase);
        }

        private static string CommandId(Core.Command command)
        {
            return command switch
            {
                Core.Command.Create create => create.Id,
                Core.Command.Update update => update.Id,
                Core.Command.Delete delete => delete.Id,
                Core.Command.SetStatus setStatus => setStatus.Id,
                Core.Command.SetInstanceComplete setInstance => setInstance.Id,
                _ => throw new InvalidOperationException("Unknown parked command variant."),
            };
        }

        private static string ErrorMessage(Core.CoreException error)
        {
            return error switch
            {
                Core.CoreException.Invariant invariant => invariant.message,
                Core.CoreException.Network network => network.message,
                Core.CoreException.Api api => $"{api.message} (HTTP {api.status})",
                Core.CoreException.Validation validation => validation.message,
                Core.CoreException.NotFound notFound => notFound.message,
                Core.CoreException.Connection connection => connection.message,
                _ => error.Message,
            };
        }

        private TaskNotesSyncState MapState(Core.SyncState state)
        {
            return state switch
            {
                Core.SyncState.Unconfigured => TaskNotesSyncState.Unconfigured,
                Core.SyncState.Syncing => TaskNotesSyncState.Synchronizing,
                Core.SyncState.Idle => _configured
                    ? TaskNotesSyncState.Connected
                    : TaskNotesSyncState.Unconfigured,
                Core.SyncState.AuthError => TaskNotesSyncState.AuthenticationFailure,
                Core.SyncState.Backoff
                    when RequireEngine().Status().LastError
                        is Core.CoreException.Network
                            or Core.CoreException.Connection => TaskNotesSyncState.CachedOffline,
                Core.SyncState.Backoff => TaskNotesSyncState.SynchronizationError,
                _ => throw new InvalidOperationException($"Unknown synchronization state {state}."),
            };
        }

        private static TaskNotesSyncState LiveFailureState(Core.CoreException error)
        {
            return error switch
            {
                Core.CoreException.Api api when api.status is 401 or 403 =>
                    TaskNotesSyncState.AuthenticationFailure,
                Core.CoreException.Connection or Core.CoreException.Network =>
                    TaskNotesSyncState.CachedOffline,
                _ => TaskNotesSyncState.SynchronizationError,
            };
        }

        private string Today()
        {
            return _clock.LocalYmd(_clock.NowMillis());
        }

        private Core.FfiSyncEngine RequireEngine()
        {
            return _engine
                ?? throw new InvalidOperationException("The TaskNotes engine is not initialized.");
        }

        private Core.TaskNotesApi RequireApi()
        {
            return _api
                ?? throw new Core.CoreException.Validation("Configure a TaskNotes server first.");
        }

        private async Task PublishObservedAsync(CancellationToken cancellationToken)
        {
            TaskNotesState state = await _runner
                .RunAsync(Observe, cancellationToken)
                .ConfigureAwait(false);
            await PublishAsync(state).ConfigureAwait(false);
        }

        private async ValueTask OnRetryTimerAsync()
        {
            if (_disposed)
            {
                return;
            }
            TaskNotesState state = await _runner
                .RunAsync(() =>
                {
                    Core.FfiSyncEngine engine = RequireEngine();
                    engine.RequestSync();
                    try
                    {
                        engine.Settle();
                    }
                    catch (Core.CoreException)
                    {
                        // Status() is the synchronization error surface.
                    }
                    return Observe();
                })
                .ConfigureAwait(false);
            await PublishAsync(state).ConfigureAwait(false);
        }

        private async Task DrainAndPublishAsync()
        {
            try
            {
                TaskNotesState state = await _runner
                    .RunAsync(() =>
                    {
                        try
                        {
                            RequireEngine().Settle();
                        }
                        catch (Core.CoreException)
                        {
                            // Status() is the synchronization error surface.
                        }
                        return Observe();
                    })
                    .ConfigureAwait(false);
                await PublishAsync(state).ConfigureAwait(false);
            }
            catch (ObjectDisposedException)
            {
                LogBackgroundSynchronizationStopped(_logger);
            }
        }

        private Task PublishAsync(TaskNotesState state)
        {
            ApplyState(state);
            return Task.CompletedTask;
        }

        [LoggerMessage(
            EventId = 1000,
            Level = LogLevel.Debug,
            Message = "Background synchronization stopped during disposal."
        )]
        private static partial void LogBackgroundSynchronizationStopped(ILogger logger);

        private void ApplyState(TaskNotesState state)
        {
            State = state;
            StateChanged?.Invoke(this, EventArgs.Empty);
        }

        private void RetireEngine()
        {
            if (_engine is not null)
            {
                _engine.Shutdown();
                _engine.Dispose();
                _engine = null;
            }
            _api?.Dispose();
            _api = null;
            _transport?.Dispose();
            _transport = null;
            _configured = false;
            _taskTime = null;
            _timeReport = null;
            _pomodoro = null;
            _completionUndo.Clear();
        }

        private void ThrowIfDisposed()
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
        }
    }
}
