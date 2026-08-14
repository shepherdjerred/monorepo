using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests
{
    internal sealed class TestTaskNotesStore : ITaskNotesStore
    {
        internal int AddCount { get; private set; }
        internal int DeleteCount { get; private set; }
        internal int RefreshCount { get; private set; }
        internal int UndoCount { get; private set; }
        internal int SetStatusCount { get; private set; }
        internal int SetCompletionCount { get; private set; }
        internal int CompleteCount { get; private set; }
        internal int ScheduleCount { get; private set; }
        internal int PrioritizeCount { get; private set; }
        internal int DeleteManyCount { get; private set; }
        internal int TimingCount { get; private set; }
        internal int PomodoroCount { get; private set; }
        internal int ParkedCount { get; private set; }
        internal string? LastAddedInput { get; private set; }
        internal TaskListQuery? LastAddContext { get; private set; }
        internal TaskListQuery? LastQuery { get; private set; }
        internal TaskEditInput? LastEdit { get; private set; }
        internal string? LastDeletedId { get; private set; }
        internal QuickAddPreview Preview { get; set; } =
            new("Preview", null, "normal", [], [], [], null);
        internal Func<string?, string?, CancellationToken, Task>? Reconfigure { get; set; }

        public event EventHandler? StateChanged;

        public TaskNotesState State { get; internal set; } = TaskNotesState.Unconfigured;

        internal void Publish(TaskNotesState state)
        {
            State = state;
            StateChanged?.Invoke(this, EventArgs.Empty);
        }

        public Task InitializeAsync(
            string? serverUrl,
            string? token,
            CancellationToken cancellationToken = default
        ) => Task.CompletedTask;

        public Task ReconfigureAsync(
            string? serverUrl,
            string? token,
            CancellationToken cancellationToken = default
        )
        {
            return Reconfigure?.Invoke(serverUrl, token, cancellationToken) ?? Task.CompletedTask;
        }

        public Task RefreshAsync(CancellationToken cancellationToken = default)
        {
            RefreshCount++;
            return Task.CompletedTask;
        }

        public Task SetQueryAsync(
            TaskListQuery query,
            CancellationToken cancellationToken = default
        )
        {
            LastQuery = query;
            return Task.CompletedTask;
        }

        public Task<QuickAddPreview> PreviewQuickAddAsync(
            string input,
            CancellationToken cancellationToken = default
        ) => Task.FromResult(Preview);

        public Task AddAsync(
            string input,
            TaskListQuery context,
            CancellationToken cancellationToken = default
        )
        {
            AddCount++;
            LastAddedInput = input;
            LastAddContext = context;
            return Task.CompletedTask;
        }

        public Task UpdateTaskAsync(
            TaskEditInput input,
            CancellationToken cancellationToken = default
        )
        {
            LastEdit = input;
            return Task.CompletedTask;
        }

        public Task DeleteTaskAsync(string taskId, CancellationToken cancellationToken = default)
        {
            DeleteCount++;
            LastDeletedId = taskId;
            return Task.CompletedTask;
        }

        public Task SetStatusAsync(
            string taskId,
            string status,
            CancellationToken cancellationToken = default
        )
        {
            SetStatusCount++;
            return Task.CompletedTask;
        }

        public Task SetCompletionAsync(
            string taskId,
            bool completed,
            CancellationToken cancellationToken = default
        )
        {
            SetCompletionCount++;
            return Task.CompletedTask;
        }

        public Task CompleteTasksAsync(
            IReadOnlyList<string> taskIds,
            CancellationToken cancellationToken = default
        )
        {
            CompleteCount++;
            return Task.CompletedTask;
        }

        public Task UndoCompletionAsync(CancellationToken cancellationToken = default)
        {
            UndoCount++;
            return Task.CompletedTask;
        }

        public Task ScheduleTasksAsync(
            IReadOnlyList<string> taskIds,
            string? scheduled,
            CancellationToken cancellationToken = default
        )
        {
            ScheduleCount++;
            return Task.CompletedTask;
        }

        public Task PrioritizeTasksAsync(
            IReadOnlyList<string> taskIds,
            string priority,
            CancellationToken cancellationToken = default
        )
        {
            PrioritizeCount++;
            return Task.CompletedTask;
        }

        public Task DeleteTasksAsync(
            IReadOnlyList<string> taskIds,
            CancellationToken cancellationToken = default
        )
        {
            DeleteManyCount++;
            return Task.CompletedTask;
        }

        public Task LoadTaskTimeAsync(
            string taskId,
            CancellationToken cancellationToken = default
        ) => RecordTimingAsync();

        public Task StartTimeTrackingAsync(
            string taskId,
            CancellationToken cancellationToken = default
        ) => RecordTimingAsync();

        public Task StopTimeTrackingAsync(
            string taskId,
            CancellationToken cancellationToken = default
        ) => RecordTimingAsync();

        public Task LoadTimeReportAsync(
            string period = "all",
            CancellationToken cancellationToken = default
        ) => RecordTimingAsync();

        public Task LoadPomodoroAsync(CancellationToken cancellationToken = default) =>
            RecordPomodoroAsync();

        public Task StartPomodoroAsync(
            string? taskId,
            CancellationToken cancellationToken = default
        ) => RecordPomodoroAsync();

        public Task PauseOrResumePomodoroAsync(CancellationToken cancellationToken = default) =>
            RecordPomodoroAsync();

        public Task StopPomodoroAsync(CancellationToken cancellationToken = default) =>
            RecordPomodoroAsync();

        public Task<SavedViewDefinition> CreateSavedViewAsync(
            string name,
            string symbol,
            string tint,
            bool favorite,
            TaskListQuery query,
            CancellationToken cancellationToken = default
        ) => throw new NotSupportedException();

        public Task UpdateSavedViewAsync(
            SavedViewDefinition view,
            CancellationToken cancellationToken = default
        ) => Task.CompletedTask;

        public Task<SavedViewDefinition> DuplicateSavedViewAsync(
            string viewId,
            CancellationToken cancellationToken = default
        ) => throw new NotSupportedException();

        public Task DeleteSavedViewAsync(
            string viewId,
            CancellationToken cancellationToken = default
        ) => Task.CompletedTask;

        public Task MoveSavedViewAsync(
            string viewId,
            int index,
            CancellationToken cancellationToken = default
        ) => Task.CompletedTask;

        public Task RestoreDefaultSavedViewsAsync(CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task RetryParkedMutationAsync(
            string mutationId,
            CancellationToken cancellationToken = default
        ) => RecordParkedAsync();

        public Task DiscardParkedMutationAsync(
            string mutationId,
            CancellationToken cancellationToken = default
        ) => RecordParkedAsync();

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;

        private Task RecordTimingAsync()
        {
            TimingCount++;
            return Task.CompletedTask;
        }

        private Task RecordPomodoroAsync()
        {
            PomodoroCount++;
            return Task.CompletedTask;
        }

        private Task RecordParkedAsync()
        {
            ParkedCount++;
            return Task.CompletedTask;
        }
    }
}
