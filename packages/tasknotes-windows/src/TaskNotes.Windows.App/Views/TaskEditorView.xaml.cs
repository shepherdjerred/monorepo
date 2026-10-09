using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.App.Views
{
    /// <summary>Compiled task-inspector view over the portable editor model.</summary>
    public sealed partial class TaskEditorView : UserControl
    {
        /// <summary>Identifies the portable view-model dependency property.</summary>
        public static readonly DependencyProperty ViewModelProperty = DependencyProperty.Register(
            nameof(ViewModel),
            typeof(TaskEditorViewModel),
            typeof(TaskEditorView),
            new PropertyMetadata(null)
        );

        private UiOperationQueue? _operations;
        private Func<Func<Task>, Task<bool>>? _execute;
        private Func<string, string, Task<bool>>? _confirm;
        private Action<string>? _showValidation;
        private bool _synchronizingControls;

        /// <summary>Initializes the compiled editor view.</summary>
        public TaskEditorView()
        {
            InitializeComponent();
            EditorFields.IsEnabled = false;
        }

        /// <summary>Gets or sets portable editor state.</summary>
        public TaskEditorViewModel? ViewModel
        {
            get => GetValue(ViewModelProperty) is TaskEditorViewModel viewModel ? viewModel : null;
            set => SetValue(ViewModelProperty, value);
        }

        internal void Initialize(
            UiOperationQueue operations,
            Func<Func<Task>, Task<bool>> execute,
            Func<string, string, Task<bool>> confirm,
            Action<string> showValidation
        )
        {
            _operations = operations ?? throw new ArgumentNullException(nameof(operations));
            _execute = execute ?? throw new ArgumentNullException(nameof(execute));
            _confirm = confirm ?? throw new ArgumentNullException(nameof(confirm));
            _showValidation =
                showValidation ?? throw new ArgumentNullException(nameof(showValidation));
        }

        internal void Load(TaskItem task)
        {
            RequireViewModel().Load(task);
            Visibility = Visibility.Visible;
            EditorFields.IsEnabled = true;
            EmptyInspector.Visibility = Visibility.Collapsed;
            SynchronizeDates();
        }

        internal void Refresh(TaskNotesState state)
        {
            TaskEditorViewModel viewModel = RequireViewModel();
            if (viewModel.IsDirty || viewModel.IsCommitting)
                return;
            if (viewModel.TaskId is not string taskId)
            {
                return;
            }
            TaskItem? current = state.AllTasks.SingleOrDefault(task =>
                string.Equals(task.Id, taskId, StringComparison.Ordinal)
                && task.ProfileId == viewModel.ProfileId
            );
            if (current is null)
            {
                Clear();
            }
            else if (!viewModel.IsDirty)
            {
                Load(current);
            }
        }

        internal void Clear()
        {
            RequireViewModel().Clear();
            EditorFields.IsEnabled = false;
            EmptyInspector.Visibility = Visibility.Visible;
        }

        private void AddReminder_Click(object sender, RoutedEventArgs e)
        {
            _ = sender;
            _ = e;
            RequireViewModel().AddReminder();
            CommitField("reminders");
        }

        private void RemoveReminder_Click(object sender, RoutedEventArgs e)
        {
            if (sender is FrameworkElement { DataContext: ReminderEditorRow row })
            {
                RequireViewModel().RemoveReminder(row);
                CommitField("reminders");
            }
        }

        internal async Task<bool> ConfirmDiscardAsync()
        {
            TaskEditorViewModel viewModel = RequireViewModel();
            if (await FlushAsync())
            {
                return true;
            }
            bool discard = await RequireConfirm()(
                "Discard this draft?",
                viewModel.NeedsObservation
                        ? "The action was applied, but its result could not be observed. Cancel to refresh or review recovery in Settings. Continue only clears this inspector's retained draft."
                    : viewModel.RecoveryActionId is not null
                        ? "This submitted action has an uncertain result. Review its exact action in Settings recovery. Continue clears the inspector draft; it does not retire or resubmit the action."
                    : "The draft could not be saved. Cancel to keep editing or Retry. Discard clears the draft without changing the vault."
            );
            if (discard)
            {
                viewModel.Discard();
            }
            return discard;
        }

        internal async Task<bool> FlushAsync()
        {
            var viewModel = RequireViewModel();
            if (!viewModel.IsLoaded)
                return true;
            bool saved = false;
            var execute =
                _execute ?? throw new InvalidOperationException("Initialize the editor executor.");
            bool executed = await execute(async () => saved = await viewModel.SaveAsync());
            return executed
                && saved
                && !viewModel.IsDirty
                && !viewModel.NeedsObservation
                && viewModel.RecoveryActionId is null;
        }

        private void Field_Blur(object sender, RoutedEventArgs args)
        {
            _ = args;
            if (sender is FrameworkElement { Tag: string field })
                CommitField(field);
        }

        private void Title_KeyDown(object sender, KeyRoutedEventArgs args)
        {
            _ = sender;
            if (args.Key == global::Windows.System.VirtualKey.Enter)
            {
                args.Handled = true;
                CommitField("title");
            }
        }

        private void Control_SelectionChanged(object sender, SelectionChangedEventArgs args)
        {
            _ = args;
            if (sender is FrameworkElement { Tag: string field } && !_synchronizingControls)
                _ = DispatcherQueue.TryEnqueue(() => CommitField(field));
        }

        private void CommitField(string field)
        {
            var viewModel = RequireViewModel();
            if (!viewModel.IsLoaded || _synchronizingControls)
                return;
            Run(
                "commit-editor-field",
                async () =>
                {
                    if (!await viewModel.CommitFieldAsync(field))
                        RequireValidation()(
                            viewModel.CommitError
                                ?? viewModel.ValidationError
                                ?? "This draft needs attention before it can be saved."
                        );
                }
            );
        }

        private void BodyDone_Click(object sender, RoutedEventArgs args)
        {
            _ = sender;
            _ = args;
            CommitField("body");
        }

        private void RemoveProjects_Click(object sender, RoutedEventArgs args)
        {
            _ = args;
            var model = RequireViewModel();
            model.Projects = RemoveToken(model.ProjectsTokens, sender);
            CommitField("projects");
        }

        private void RemoveContexts_Click(object sender, RoutedEventArgs args)
        {
            _ = args;
            var model = RequireViewModel();
            model.Contexts = RemoveToken(model.ContextsTokens, sender);
            CommitField("contexts");
        }

        private void RemoveTags_Click(object sender, RoutedEventArgs args)
        {
            _ = args;
            var model = RequireViewModel();
            model.Tags = RemoveToken(model.TagsTokens, sender);
            CommitField("tags");
        }

        private static string RemoveToken(IReadOnlyList<string> values, object sender) =>
            sender is FrameworkElement { Tag: string token }
                ? string.Join(", ", values.Where(value => value != token))
                : throw new InvalidOperationException("The token action has no value.");

        private void Discard_Click(object sender, RoutedEventArgs args)
        {
            _ = sender;
            _ = args;
            RequireViewModel().Discard();
            SynchronizeDates();
        }

        private void Token_TextChanged(
            AutoSuggestBox sender,
            AutoSuggestBoxTextChangedEventArgs args
        )
        {
            if (
                args.Reason != AutoSuggestionBoxTextChangeReason.UserInput
                || _synchronizingControls
                || !RequireViewModel().IsLoaded
            )
                return;
            SetTokens((string)sender.Tag, sender.Text);
            sender.ItemsSource = RequireViewModel()
                .TokenSuggestions((string)sender.Tag, sender.Text);
        }

        private void Token_QuerySubmitted(
            AutoSuggestBox sender,
            AutoSuggestBoxQuerySubmittedEventArgs args
        )
        {
            if (!RequireViewModel().IsLoaded)
                return;
            string text = args.QueryText;
            if (args.ChosenSuggestion is string chosen)
            {
                string[] tokens = text.Split(',');
                text = string.Join(
                    ", ",
                    tokens
                        .SkipLast(1)
                        .Select(value => value.Trim())
                        .Append(chosen)
                        .Where(value => value.Length > 0)
                        .Distinct(StringComparer.Ordinal)
                );
            }
            sender.Text = text;
            SetTokens((string)sender.Tag, text);
            CommitField((string)sender.Tag);
        }

        private void SetTokens(string field, string value)
        {
            switch (field)
            {
                case "projects":
                    RequireViewModel().Projects = value;
                    break;
                case "contexts":
                    RequireViewModel().Contexts = value;
                    break;
                case "tags":
                    RequireViewModel().Tags = value;
                    break;
                default:
                    throw new ArgumentOutOfRangeException(nameof(field));
            }
        }

        private void Date_Changed(
            CalendarDatePicker sender,
            CalendarDatePickerDateChangedEventArgs args
        )
        {
            _ = args;
            if (_synchronizingControls || !RequireViewModel().IsLoaded)
                return;
            string? value = sender.Date?.ToString(
                "yyyy-MM-dd",
                System.Globalization.CultureInfo.InvariantCulture
            );
            string field = (string)sender.Tag;
            if (field == "due")
                RequireViewModel().Due = value;
            else
                RequireViewModel().Scheduled = value;
            CommitField(field);
        }

        private void SynchronizeDates()
        {
            _synchronizingControls = true;
            try
            {
                DuePicker.Date = CivilDate(RequireViewModel().Due);
                ScheduledPicker.Date = CivilDate(RequireViewModel().Scheduled);
                SynchronizeRecurrence();
            }
            finally
            {
                _synchronizingControls = false;
            }
        }

        private static DateTimeOffset? CivilDate(string? value) =>
            DateOnly.TryParseExact(
                value,
                "yyyy-MM-dd",
                System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None,
                out var date
            )
                ? new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Local))
                : null;

        private void SynchronizeRecurrence()
        {
            string raw = RequireViewModel().Recurrence ?? "";
            string[] parts = raw.Split(';');
            var pairs = parts
                .Where(part => part.Contains('=', StringComparison.Ordinal))
                .Select(part => part.Split('=', 2))
                .ToArray();
            bool supported =
                raw.Length == 0
                || (
                    pairs.Length == parts.Length
                    && pairs.Select(pair => pair[0]).Distinct(StringComparer.Ordinal).Count()
                        == pairs.Length
                    && pairs.All(pair => pair[0] is "FREQ" or "INTERVAL" or "BYDAY")
                );
            string? frequency = supported
                ? pairs.FirstOrDefault(pair => pair[0] == "FREQ")?[1]
                : null;
            var choice =
                raw.Length > 0 && frequency is null
                    ? null
                    : RecurrenceFrequency
                        .Items.OfType<ComboBoxItem>()
                        .SingleOrDefault(item => (string)item.Tag == (frequency ?? ""));
            RecurrenceFrequency.SelectedItem = choice;
            string? interval = pairs.FirstOrDefault(pair => pair[0] == "INTERVAL")?[1];
            RecurrenceInterval.Value = int.TryParse(
                interval,
                System.Globalization.NumberStyles.None,
                System.Globalization.CultureInfo.InvariantCulture,
                out int parsed
            )
                ? parsed
                : 1;
            string[] days = (pairs.FirstOrDefault(pair => pair[0] == "BYDAY")?[1] ?? "").Split(',');
            foreach (var day in RecurrenceDays.Children.OfType<CheckBox>())
                day.IsChecked = days.Contains((string)day.Tag, StringComparer.Ordinal);
        }

        private void RecurrenceApply_Click(object sender, RoutedEventArgs args)
        {
            _ = sender;
            _ = args;
            if (RecurrenceFrequency.SelectedItem is not ComboBoxItem { Tag: string frequency })
            {
                RequireValidation()(
                    "Choose a frequency to replace the existing recurrence; its exact raw value remains below."
                );
                return;
            }
            if (!double.IsFinite(RecurrenceInterval.Value) || RecurrenceInterval.Value < 1)
            {
                RequireValidation()("Choose an interval of at least one.");
                return;
            }
            int interval = checked((int)RecurrenceInterval.Value);
            var days = RecurrenceDays
                .Children.OfType<CheckBox>()
                .Where(day => day.IsChecked == true)
                .Select(day => (string)day.Tag)
                .ToArray();
            RequireViewModel().Recurrence =
                frequency == ""
                    ? null
                    : $"FREQ={frequency};INTERVAL={interval}"
                        + (
                            frequency == "WEEKLY" && days.Length > 0
                                ? ";BYDAY=" + string.Join(",", days)
                                : ""
                        );
            CommitField("recurrence");
        }

        private void Save_Click(object sender, RoutedEventArgs eventArgs)
        {
            _ = sender;
            _ = eventArgs;
            TaskEditorViewModel viewModel = RequireViewModel();
            if (!viewModel.IsLoaded)
            {
                return;
            }
            Run(
                "save-editor",
                async () =>
                {
                    if (!await viewModel.SaveAsync())
                    {
                        RequireValidation()(
                            viewModel.ValidationError ?? "Task validation failed without a message."
                        );
                    }
                }
            );
        }

        private void Delete_Click(object sender, RoutedEventArgs eventArgs)
        {
            _ = sender;
            _ = eventArgs;
            TaskEditorViewModel viewModel = RequireViewModel();
            if (!viewModel.IsLoaded)
            {
                return;
            }
            Run(
                "delete-editor-task",
                async () =>
                {
                    string? task = viewModel.TaskId;
                    string? profile = viewModel.ProfileId;
                    if (!await FlushAsync())
                        return;
                    if (await RequireConfirm()("Delete task?", $"Delete '{viewModel.Title}'?"))
                    {
                        if (viewModel.TaskId != task || viewModel.ProfileId != profile)
                            throw new ArgumentException(
                                "The inspector owner changed while deletion was open. Review the original task before deleting it."
                            );
                        await viewModel.DeleteAsync();
                        Clear();
                    }
                }
            );
        }

        private void Run(string operationName, Func<Task> operation)
        {
            UiOperationQueue operations =
                _operations
                ?? throw new InvalidOperationException("Initialize the editor operation queue.");
            Func<Func<Task>, Task<bool>> execute =
                _execute ?? throw new InvalidOperationException("Initialize the editor executor.");
            operations.Run(
                operationName,
                async () =>
                {
                    _ = await execute(operation);
                }
            );
        }

        private Func<string, string, Task<bool>> RequireConfirm() =>
            _confirm
            ?? throw new InvalidOperationException("Initialize the editor dialog service.");

        private Action<string> RequireValidation() =>
            _showValidation
            ?? throw new InvalidOperationException("Initialize the editor validation surface.");

        private TaskEditorViewModel RequireViewModel() =>
            ViewModel ?? throw new InvalidOperationException("Attach the task editor view model.");
    }
}
