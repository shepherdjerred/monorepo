using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;
using Windows.Graphics;

namespace TaskNotes.Windows.App
{
    internal sealed class PomodoroWindow : Window
    {
        private readonly PomodoroViewModel _viewModel;
        private readonly TextBlock _status = new()
        {
            Text = "Loading live Pomodoro state…",
            TextWrapping = TextWrapping.Wrap,
        };
        private readonly TextBox _taskId = new()
        {
            Header = "Optional task ID",
            PlaceholderText = "Attach this interval to a task",
        };
        private readonly Button _start = new() { Content = "Start" };
        private readonly Button _pause = new() { Content = "Pause / resume" };
        private readonly Button _stop = new() { Content = "Stop" };
        private readonly UiOperationQueue _uiOperations;

        internal PomodoroWindow(PomodoroViewModel viewModel, UiOperationQueue uiOperations)
        {
            _viewModel = viewModel ?? throw new ArgumentNullException(nameof(viewModel));
            _uiOperations = uiOperations ?? throw new ArgumentNullException(nameof(uiOperations));
            Title = "TaskNotes Pomodoro";
            AppWindow.Resize(new SizeInt32(430, 330));
            AppWindow.Closing += AppWindow_Closing;
            _viewModel.PropertyChanged += ViewModel_PropertyChanged;
            _start.Click += Start_Click;
            _pause.Click += Pause_Click;
            _stop.Click += Stop_Click;

            AutomationProperties.SetAutomationId(_status, AutomationIds.PomodoroStatus);
            AutomationProperties.SetLiveSetting(
                _status,
                Microsoft.UI.Xaml.Automation.Peers.AutomationLiveSetting.Polite
            );

            StackPanel commands = new() { Orientation = Orientation.Horizontal, Spacing = 8 };
            commands.Children.Add(_start);
            commands.Children.Add(_pause);
            commands.Children.Add(_stop);
            StackPanel root = new() { Padding = new Thickness(24), Spacing = 16 };
            AutomationProperties.SetAutomationId(root, AutomationIds.PomodoroWindow);
            root.Children.Add(
                new TextBlock
                {
                    Text = "Pomodoro",
                    Style = Application.Current.Resources["TitleTextBlockStyle"] as Style,
                }
            );
            root.Children.Add(_status);
            root.Children.Add(_taskId);
            root.Children.Add(commands);
            Content = root;
        }

        internal async Task LoadAsync()
        {
            await RunAsync(() => _viewModel.LoadAsync());
        }

        private void Start_Click(object sender, RoutedEventArgs e)
        {
            _ = sender;
            _ = e;
            _uiOperations.Run(
                "start-pomodoro",
                () =>
                    RunAsync(() =>
                        _viewModel.StartAsync(
                            string.IsNullOrWhiteSpace(_taskId.Text) ? null : _taskId.Text.Trim()
                        )
                    )
            );
        }

        private void Pause_Click(object sender, RoutedEventArgs e)
        {
            _ = sender;
            _ = e;
            _uiOperations.Run(
                "pause-or-resume-pomodoro",
                () => RunAsync(() => _viewModel.PauseOrResumeAsync())
            );
        }

        private void Stop_Click(object sender, RoutedEventArgs e)
        {
            _ = sender;
            _ = e;
            _uiOperations.Run("stop-pomodoro", () => RunAsync(() => _viewModel.StopAsync()));
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
            PomodoroReading? reading = _viewModel.State;
            _status.Text =
                reading is null ? "No live Pomodoro state has been loaded."
                : reading.IsActive
                    ? $"{reading.Phase ?? "Active"} · {reading.SecondsRemaining?.ToString(CultureInfo.InvariantCulture) ?? "?"} seconds remaining"
                : "No Pomodoro interval is active.";
            _pause.IsEnabled = reading?.IsActive == true;
            _stop.IsEnabled = reading?.IsActive == true;
            RaiseLiveRegionChanged(_status);
        }

        private static void RaiseLiveRegionChanged(FrameworkElement element)
        {
            Microsoft.UI.Xaml.Automation.Peers.AutomationPeer? existing =
                Microsoft.UI.Xaml.Automation.Peers.FrameworkElementAutomationPeer.FromElement(
                    element
                );
            Microsoft.UI.Xaml.Automation.Peers.FrameworkElementAutomationPeer peer = existing
                is Microsoft.UI.Xaml.Automation.Peers.FrameworkElementAutomationPeer elementPeer
                ? elementPeer
                : new Microsoft.UI.Xaml.Automation.Peers.FrameworkElementAutomationPeer(element);
            peer.RaiseAutomationEvent(
                Microsoft.UI.Xaml.Automation.Peers.AutomationEvents.LiveRegionChanged
            );
        }

        private async Task RunAsync(Func<Task> operation)
        {
            try
            {
                await operation();
                UpdateState();
            }
            catch (Exception exception)
            {
                string? message = TaskNotesExceptionPolicy.UserFacingMessage(exception);
                if (message is null)
                {
                    throw;
                }
                _status.Text = message;
            }
        }

        private void AppWindow_Closing(
            Microsoft.UI.Windowing.AppWindow sender,
            Microsoft.UI.Windowing.AppWindowClosingEventArgs args
        )
        {
            _ = sender;
            _ = args;
            _viewModel.PropertyChanged -= ViewModel_PropertyChanged;
        }
    }
}
