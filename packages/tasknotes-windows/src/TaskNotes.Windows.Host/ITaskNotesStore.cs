namespace TaskNotes.Windows.Host
{
    /// <summary>Portable async facade consumed by Windows presentation models.</summary>
    public interface ITaskNotesStore : IAsyncDisposable
    {
        /// <summary>Occurs after a new immutable state snapshot is published.</summary>
        event EventHandler? StateChanged;

        /// <summary>Gets the latest immutable state snapshot.</summary>
        TaskNotesState State { get; }

        /// <summary>Restores cached state and synchronizes the configured server.</summary>
        Task InitializeAsync(
            string? serverUrl,
            string? token,
            CancellationToken cancellationToken = default
        );

        /// <summary>Replaces server configuration and synchronizes.</summary>
        Task ReconfigureAsync(
            string? serverUrl,
            string? token,
            CancellationToken cancellationToken = default
        );

        /// <summary>Runs an explicit synchronization pass.</summary>
        Task RefreshAsync(CancellationToken cancellationToken = default);

        /// <summary>Selects the active task projection.</summary>
        Task SetQueryAsync(TaskListQuery query, CancellationToken cancellationToken = default);

        /// <summary>Previews natural-language task input.</summary>
        Task<QuickAddPreview> PreviewQuickAddAsync(
            string input,
            CancellationToken cancellationToken = default
        );

        /// <summary>Adds a task in the current context.</summary>
        Task AddAsync(
            string input,
            TaskListQuery context,
            CancellationToken cancellationToken = default
        );

        /// <summary>Updates every editable task field.</summary>
        Task UpdateTaskAsync(TaskEditInput input, CancellationToken cancellationToken = default);

        /// <summary>Deletes one task.</summary>
        Task DeleteTaskAsync(string taskId, CancellationToken cancellationToken = default);

        /// <summary>Sets an absolute task status.</summary>
        Task SetStatusAsync(
            string taskId,
            string status,
            CancellationToken cancellationToken = default
        );

        /// <summary>Sets task or occurrence completion.</summary>
        Task SetCompletionAsync(
            string taskId,
            bool completed,
            CancellationToken cancellationToken = default
        );

        /// <summary>Completes a task group as one undo entry.</summary>
        Task CompleteTasksAsync(
            IReadOnlyList<string> taskIds,
            CancellationToken cancellationToken = default
        );

        /// <summary>Restores the latest completion entry.</summary>
        Task UndoCompletionAsync(CancellationToken cancellationToken = default);

        /// <summary>Schedules multiple tasks.</summary>
        Task ScheduleTasksAsync(
            IReadOnlyList<string> taskIds,
            string? scheduled,
            CancellationToken cancellationToken = default
        );

        /// <summary>Changes priority for multiple tasks.</summary>
        Task PrioritizeTasksAsync(
            IReadOnlyList<string> taskIds,
            string priority,
            CancellationToken cancellationToken = default
        );

        /// <summary>Deletes multiple tasks.</summary>
        Task DeleteTasksAsync(
            IReadOnlyList<string> taskIds,
            CancellationToken cancellationToken = default
        );

        /// <summary>Loads task timing details.</summary>
        Task LoadTaskTimeAsync(string taskId, CancellationToken cancellationToken = default);

        /// <summary>Starts task timing.</summary>
        Task StartTimeTrackingAsync(string taskId, CancellationToken cancellationToken = default);

        /// <summary>Stops task timing.</summary>
        Task StopTimeTrackingAsync(string taskId, CancellationToken cancellationToken = default);

        /// <summary>Loads the aggregate time report.</summary>
        Task LoadTimeReportAsync(
            string period = "all",
            CancellationToken cancellationToken = default
        );

        /// <summary>Loads Pomodoro state.</summary>
        Task LoadPomodoroAsync(CancellationToken cancellationToken = default);

        /// <summary>Starts a Pomodoro.</summary>
        Task StartPomodoroAsync(string? taskId, CancellationToken cancellationToken = default);

        /// <summary>Pauses or resumes the current Pomodoro.</summary>
        Task PauseOrResumePomodoroAsync(CancellationToken cancellationToken = default);

        /// <summary>Stops the current Pomodoro.</summary>
        Task StopPomodoroAsync(CancellationToken cancellationToken = default);

        /// <summary>Creates a saved view from a query.</summary>
        Task<SavedViewDefinition> CreateSavedViewAsync(
            string name,
            string symbol,
            string tint,
            bool favorite,
            TaskListQuery query,
            CancellationToken cancellationToken = default
        );

        /// <summary>Updates saved-view metadata and query documents.</summary>
        Task UpdateSavedViewAsync(
            SavedViewDefinition view,
            CancellationToken cancellationToken = default
        );

        /// <summary>Duplicates a saved view.</summary>
        Task<SavedViewDefinition> DuplicateSavedViewAsync(
            string viewId,
            CancellationToken cancellationToken = default
        );

        /// <summary>Deletes a saved view.</summary>
        Task DeleteSavedViewAsync(string viewId, CancellationToken cancellationToken = default);

        /// <summary>Moves a saved view.</summary>
        Task MoveSavedViewAsync(
            string viewId,
            int index,
            CancellationToken cancellationToken = default
        );

        /// <summary>Restores default saved views.</summary>
        Task RestoreDefaultSavedViewsAsync(CancellationToken cancellationToken = default);

        /// <summary>Retries a parked mutation.</summary>
        Task RetryParkedMutationAsync(
            string mutationId,
            CancellationToken cancellationToken = default
        );

        /// <summary>Discards a parked mutation.</summary>
        Task DiscardParkedMutationAsync(
            string mutationId,
            CancellationToken cancellationToken = default
        );
    }
}
