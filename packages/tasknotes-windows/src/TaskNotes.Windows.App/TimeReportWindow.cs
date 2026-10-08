using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;
using Windows.Graphics;

namespace TaskNotes.Windows.App
{
    internal sealed class TimeReportWindow : Window
    {
        private readonly TimeReportViewModel _viewModel;
        private readonly ComboBox _period = new() { Header = "Period", SelectedIndex = 0 };
        private readonly TextBlock _total = new() { Text = "Loading…" };
        private readonly ListView _rows = new() { SelectionMode = ListViewSelectionMode.None };
        private readonly UiOperationQueue _uiOperations;
        private readonly ListView _sessions = new() { SelectionMode = ListViewSelectionMode.None };
        private readonly TextBlock _sessionSummary = new();
        private readonly Button _moreSessions = new() { Content = "More running sessions" };
        private readonly Func<string, string, Task> _openTask;
        private bool _closed;

        internal TimeReportWindow(
            TimeReportViewModel viewModel,
            UiOperationQueue uiOperations,
            Func<string, string, Task> openTask
        )
        {
            _viewModel = viewModel ?? throw new ArgumentNullException(nameof(viewModel));
            _uiOperations = uiOperations ?? throw new ArgumentNullException(nameof(uiOperations));
            _openTask = openTask ?? throw new ArgumentNullException(nameof(openTask));
            Title = "Facet Time Report";
            AppWindow.Resize(new SizeInt32(640, 620));
            AppWindow.Closing += AppWindow_Closing;
            _viewModel.PropertyChanged += ViewModel_PropertyChanged;
            AutomationProperties.SetAutomationId(_total, AutomationIds.TimeReportTotal);
            AutomationProperties.SetAutomationId(_rows, AutomationIds.TimeReportRows);
            foreach (string value in new[] { "all", "today", "week", "month" })
            {
                _period.Items.Add(value);
            }
            _period.SelectionChanged += Period_SelectionChanged;
            StackPanel root = new() { Padding = new Thickness(24), Spacing = 14 };
            AutomationProperties.SetAutomationId(root, AutomationIds.TimeReportWindow);
            root.Children.Add(
                new TextBlock
                {
                    Text = "Time Report",
                    Style = Application.Current.Resources["TitleTextBlockStyle"] as Style,
                }
            );
            root.Children.Add(_period);
            root.Children.Add(_total);
            root.Children.Add(_rows);
            root.Children.Add(new TextBlock { Text = "Running sessions" });
            root.Children.Add(_sessionSummary);
            root.Children.Add(_sessions);
            Button refreshSessions = new() { Content = "Refresh running sessions" };
            refreshSessions.Click += (_, _) =>
                _uiOperations.Run("refresh-running-sessions", () => _viewModel.LoadSessionsAsync());
            _moreSessions.Click += (_, _) =>
                _uiOperations.Run(
                    "more-running-sessions",
                    () => _viewModel.LoadSessionsAsync(true)
                );
            root.Children.Add(refreshSessions);
            root.Children.Add(_moreSessions);
            Content = root;
        }

        internal async Task LoadAsync()
        {
            await RunAsync();
            await _viewModel.LoadSessionsAsync();
            UpdateState();
        }

        private void Period_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            _ = sender;
            _ = e;
            if (Content is not null)
            {
                _uiOperations.Run("load-time-report", RunAsync);
            }
        }

        private void ViewModel_PropertyChanged(
            object? sender,
            System.ComponentModel.PropertyChangedEventArgs e
        )
        {
            _ = sender;
            _ = e;
            _ = DispatcherQueue.TryEnqueue(UpdateState);
        }

        private void UpdateState()
        {
            if (_closed)
                return;
            _sessions.Items.Clear();
            var page = _viewModel.Sessions;
            _sessionSummary.Text = page is null
                ? "No running sessions loaded."
                : $"{page.Rows.Count} sessions on this page · {page.TotalCount} total"
                    + (page.ProblemCount == 0 ? "" : $" · {page.ProblemCount} tasks need review");
            _moreSessions.IsEnabled = page?.Next is not null;
            if (page is not null)
                foreach (var session in page.Rows)
                {
                    string profile = page.Owner.ProfileId;
                    string path = session.GetProperty("taskPath").GetString()!;
                    Button open = new()
                    {
                        Content =
                            $"{session.GetProperty("title").GetString()} · {session.GetProperty("elapsedSeconds").GetUInt64()} seconds",
                    };
                    open.Click += (_, _) =>
                        _uiOperations.Run("open-running-task", () => _openTask(profile, path));
                    _sessions.Items.Add(open);
                }
            TimeReportReading? report = _viewModel.Report;
            _total.Text = report is null
                ? "No report loaded."
                : $"Total: {report.TotalMinutes} minutes";
            _rows.Items.Clear();
            if (report is null || report.Rows.Count == 0)
            {
                _rows.Items.Add("No tracked time in this period.");
                return;
            }
            foreach (TimeReportRow row in report.Rows)
            {
                _rows.Items.Add($"{row.Title} · {row.Minutes} minutes");
            }
        }

        private async Task RunAsync()
        {
            try
            {
                string period = _period.SelectedItem as string ?? "all";
                await _viewModel.LoadAsync(period);
                UpdateState();
            }
            catch (Exception exception)
            {
                string? message = TaskNotesExceptionPolicy.UserFacingMessage(exception);
                if (message is null)
                {
                    throw;
                }
                _total.Text = message;
            }
        }

        private void AppWindow_Closing(
            Microsoft.UI.Windowing.AppWindow sender,
            Microsoft.UI.Windowing.AppWindowClosingEventArgs args
        )
        {
            _ = sender;
            _ = args;
            _closed = true;
            _viewModel.PropertyChanged -= ViewModel_PropertyChanged;
        }
    }
}
