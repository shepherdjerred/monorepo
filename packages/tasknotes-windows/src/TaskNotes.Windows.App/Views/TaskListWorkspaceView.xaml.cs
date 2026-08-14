using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.App.Views
{
    /// <summary>Native task-list controls over portable shell and editor state.</summary>
    public sealed partial class TaskListWorkspaceView : UserControl
    {
        /// <summary>Identifies the shell view-model dependency property.</summary>
        public static readonly DependencyProperty ViewModelProperty = DependencyProperty.Register(
            nameof(ViewModel),
            typeof(ShellViewModel),
            typeof(TaskListWorkspaceView),
            new PropertyMetadata(null)
        );

        /// <summary>Identifies the editor view-model dependency property.</summary>
        public static readonly DependencyProperty EditorViewModelProperty =
            DependencyProperty.Register(
                nameof(EditorViewModel),
                typeof(TaskEditorViewModel),
                typeof(TaskListWorkspaceView),
                new PropertyMetadata(null)
            );

        private bool _updatingQueryControls;

        /// <summary>Initializes the compiled task-list workspace.</summary>
        public TaskListWorkspaceView()
        {
            InitializeComponent();
            _updatingQueryControls = true;
            SortComboBox.SelectedIndex = 0;
            GroupComboBox.SelectedIndex = 0;
            _updatingQueryControls = false;
        }

        /// <summary>Gets or sets portable shell state.</summary>
        public ShellViewModel? ViewModel
        {
            get => GetValue(ViewModelProperty) is ShellViewModel viewModel ? viewModel : null;
            set => SetValue(ViewModelProperty, value);
        }

        /// <summary>Gets or sets portable editor state.</summary>
        public TaskEditorViewModel? EditorViewModel
        {
            get =>
                GetValue(EditorViewModelProperty) is TaskEditorViewModel viewModel
                    ? viewModel
                    : null;
            set => SetValue(EditorViewModelProperty, value);
        }

        internal event RoutedEventHandler? OpenPomodoroRequested;
        internal event RoutedEventHandler? OpenTimeReportRequested;
        internal event RoutedEventHandler? RefreshRequested;
        internal event Action<string>? SearchChanged;
        internal event Action<string>? SearchSubmitted;
        internal event Action<string>? SortChanged;
        internal event Action<string>? GroupChanged;
        internal event RoutedEventHandler? SaveViewRequested;
        internal event RoutedEventHandler? NewTaskRequested;
        internal event RoutedEventHandler? CompleteSelectedRequested;
        internal event RoutedEventHandler? ScheduleSelectedRequested;
        internal event RoutedEventHandler? PrioritizeSelectedRequested;
        internal event RoutedEventHandler? DeleteSelectedRequested;
        internal event RoutedEventHandler? UndoRequested;
        internal event RoutedEventHandler? CompletionRequested;
        internal event RoutedEventHandler? EditTaskRequested;
        internal event RoutedEventHandler? DeleteTaskRequested;
        internal event RoutedEventHandler? MoveStatusRequested;
        internal event Action<TaskItem>? TaskInvoked;

        internal TaskEditorView Editor => InspectorPane;

        internal string SearchText
        {
            get => SearchBox.Text;
            set => SearchBox.Text = value;
        }

        internal bool InspectorVisible
        {
            get => InspectorPane.Visibility == Visibility.Visible;
            set => InspectorPane.Visibility = value ? Visibility.Visible : Visibility.Collapsed;
        }

        internal void SetDestination(string title, string subtitle)
        {
            DestinationTitle.Text = title;
            DestinationSubtitle.Text = subtitle;
        }

        internal void SetQueryControls(TaskListQuery query)
        {
            ArgumentNullException.ThrowIfNull(query);
            _updatingQueryControls = true;
            try
            {
                SelectComboByTag(SortComboBox, query.Sort.ToString());
                SelectComboByTag(GroupComboBox, query.Group.ToString());
            }
            finally
            {
                _updatingQueryControls = false;
            }
        }

        internal void SetStatus(string message, PresentationStatusSeverity severity, bool canUndo)
        {
            StatusText.Text = message;
            UndoButton.IsEnabled = canUndo;
            StatusBar.Severity = severity switch
            {
                PresentationStatusSeverity.Error => InfoBarSeverity.Error,
                PresentationStatusSeverity.Warning => InfoBarSeverity.Warning,
                PresentationStatusSeverity.Success => InfoBarSeverity.Success,
                PresentationStatusSeverity.Information => InfoBarSeverity.Informational,
                _ => throw new InvalidOperationException(
                    $"Unknown presentation severity {severity}."
                ),
            };
            RaiseLiveRegionChanged(StatusText);
        }

        internal void ShowError(string message)
        {
            StatusText.Text = message;
            StatusBar.Severity = InfoBarSeverity.Error;
            RaiseLiveRegionChanged(StatusText);
        }

        internal void FocusSearch(FocusState state)
        {
            _ = SearchBox.Focus(state);
        }

        internal string[] SelectedTaskIds() =>
            [.. TaskList.SelectedItems.OfType<TaskItem>().Select(task => task.Id)];

        private void OpenPomodoro_Click(object sender, RoutedEventArgs eventArgs) =>
            OpenPomodoroRequested?.Invoke(sender, eventArgs);

        private void OpenTimeReport_Click(object sender, RoutedEventArgs eventArgs) =>
            OpenTimeReportRequested?.Invoke(sender, eventArgs);

        private void Refresh_Click(object sender, RoutedEventArgs eventArgs) =>
            RefreshRequested?.Invoke(sender, eventArgs);

        private void SearchBox_TextChanged(
            AutoSuggestBox sender,
            AutoSuggestBoxTextChangedEventArgs eventArgs
        )
        {
            if (eventArgs.Reason == AutoSuggestionBoxTextChangeReason.UserInput)
            {
                SearchChanged?.Invoke(sender.Text);
            }
        }

        private void SearchBox_QuerySubmitted(
            AutoSuggestBox sender,
            AutoSuggestBoxQuerySubmittedEventArgs eventArgs
        )
        {
            _ = eventArgs;
            SearchSubmitted?.Invoke(sender.Text);
        }

        private void SortComboBox_SelectionChanged(
            object sender,
            SelectionChangedEventArgs eventArgs
        )
        {
            _ = eventArgs;
            if (!_updatingQueryControls)
            {
                SortChanged?.Invoke(SelectedTag((ComboBox)sender));
            }
        }

        private void GroupComboBox_SelectionChanged(
            object sender,
            SelectionChangedEventArgs eventArgs
        )
        {
            _ = eventArgs;
            if (!_updatingQueryControls)
            {
                GroupChanged?.Invoke(SelectedTag((ComboBox)sender));
            }
        }

        private void SaveView_Click(object sender, RoutedEventArgs eventArgs) =>
            SaveViewRequested?.Invoke(sender, eventArgs);

        private void NewTask_Click(object sender, RoutedEventArgs eventArgs) =>
            NewTaskRequested?.Invoke(sender, eventArgs);

        private void CompleteSelected_Click(object sender, RoutedEventArgs eventArgs) =>
            CompleteSelectedRequested?.Invoke(sender, eventArgs);

        private void ScheduleSelected_Click(object sender, RoutedEventArgs eventArgs) =>
            ScheduleSelectedRequested?.Invoke(sender, eventArgs);

        private void PrioritizeSelected_Click(object sender, RoutedEventArgs eventArgs) =>
            PrioritizeSelectedRequested?.Invoke(sender, eventArgs);

        private void DeleteSelected_Click(object sender, RoutedEventArgs eventArgs) =>
            DeleteSelectedRequested?.Invoke(sender, eventArgs);

        private void Undo_Click(object sender, RoutedEventArgs eventArgs) =>
            UndoRequested?.Invoke(sender, eventArgs);

        private void Inspector_Click(object sender, RoutedEventArgs eventArgs)
        {
            _ = sender;
            _ = eventArgs;
            InspectorVisible = !InspectorVisible;
        }

        private void Completion_Click(object sender, RoutedEventArgs eventArgs) =>
            CompletionRequested?.Invoke(sender, eventArgs);

        private void TaskList_SelectionChanged(object sender, SelectionChangedEventArgs eventArgs)
        {
            _ = sender;
            _ = eventArgs;
            bool enabled = TaskList.SelectedItems.Count > 0;
            CompleteSelectedButton.IsEnabled = enabled;
            ScheduleSelectedButton.IsEnabled = enabled;
            PrioritizeSelectedButton.IsEnabled = enabled;
            DeleteSelectedButton.IsEnabled = enabled;
        }

        private void TaskList_ItemClick(object sender, ItemClickEventArgs eventArgs)
        {
            _ = sender;
            if (eventArgs.ClickedItem is TaskItem task)
            {
                TaskInvoked?.Invoke(task);
            }
        }

        private void EditTask_Click(object sender, RoutedEventArgs eventArgs) =>
            EditTaskRequested?.Invoke(sender, eventArgs);

        private void DeleteTask_Click(object sender, RoutedEventArgs eventArgs) =>
            DeleteTaskRequested?.Invoke(sender, eventArgs);

        private void MoveStatus_Click(object sender, RoutedEventArgs eventArgs) =>
            MoveStatusRequested?.Invoke(sender, eventArgs);

        private static string SelectedTag(ComboBox comboBox) =>
            comboBox.SelectedItem is ComboBoxItem { Tag: string value }
                ? value
                : throw new InvalidOperationException($"{comboBox.Name} has no selected value.");

        private static void SelectComboByTag(ComboBox comboBox, string value)
        {
            comboBox.SelectedItem = comboBox
                .Items.OfType<ComboBoxItem>()
                .Single(item => string.Equals(item.Tag as string, value, StringComparison.Ordinal));
        }

        private static void RaiseLiveRegionChanged(FrameworkElement element)
        {
            AutomationPeer? existing = FrameworkElementAutomationPeer.FromElement(element);
            FrameworkElementAutomationPeer peer = existing
                is FrameworkElementAutomationPeer elementPeer
                ? elementPeer
                : new FrameworkElementAutomationPeer(element);
            peer.RaiseAutomationEvent(AutomationEvents.LiveRegionChanged);
        }
    }
}
