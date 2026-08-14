using CommunityToolkit.Mvvm.ComponentModel;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Presentation
{
    /// <summary>Portable server-backed Pomodoro presentation.</summary>
    public sealed class PomodoroViewModel : ObservableObject
    {
        private readonly ITaskNotesStore _store;
        private PomodoroReading? _state;

        /// <summary>Initializes live Pomodoro presentation over the store contract.</summary>
        public PomodoroViewModel(ITaskNotesStore store)
        {
            _store = store ?? throw new ArgumentNullException(nameof(store));
        }

        /// <summary>Gets the latest Pomodoro state.</summary>
        public PomodoroReading? State
        {
            get => _state;
            private set => SetProperty(ref _state, value);
        }

        /// <summary>Loads live server state.</summary>
        public async Task LoadAsync(CancellationToken cancellationToken = default)
        {
            await _store.LoadPomodoroAsync(cancellationToken);
            State = _store.State.Pomodoro;
        }

        /// <summary>Starts an interval.</summary>
        public async Task StartAsync(string? taskId, CancellationToken cancellationToken = default)
        {
            await _store.StartPomodoroAsync(taskId, cancellationToken);
            State = _store.State.Pomodoro;
        }

        /// <summary>Pauses or resumes an interval.</summary>
        public async Task PauseOrResumeAsync(CancellationToken cancellationToken = default)
        {
            await _store.PauseOrResumePomodoroAsync(cancellationToken);
            State = _store.State.Pomodoro;
        }

        /// <summary>Stops an interval.</summary>
        public async Task StopAsync(CancellationToken cancellationToken = default)
        {
            await _store.StopPomodoroAsync(cancellationToken);
            State = _store.State.Pomodoro;
        }
    }

    /// <summary>Portable aggregate time-report presentation.</summary>
    public sealed class TimeReportViewModel : ObservableObject
    {
        private readonly ITaskNotesStore _store;
        private TimeReportReading? _report;

        /// <summary>Initializes aggregate time-report presentation over the store contract.</summary>
        public TimeReportViewModel(ITaskNotesStore store)
        {
            _store = store ?? throw new ArgumentNullException(nameof(store));
        }

        /// <summary>Gets the latest report.</summary>
        public TimeReportReading? Report
        {
            get => _report;
            private set => SetProperty(ref _report, value);
        }

        /// <summary>Loads one server aggregate period.</summary>
        public async Task LoadAsync(
            string period = "all",
            CancellationToken cancellationToken = default
        )
        {
            await _store.LoadTimeReportAsync(period, cancellationToken);
            Report = _store.State.TimeReport;
        }
    }
}
