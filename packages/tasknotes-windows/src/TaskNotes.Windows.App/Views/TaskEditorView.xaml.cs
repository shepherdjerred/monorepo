using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
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

        /// <summary>Initializes the compiled editor view.</summary>
        public TaskEditorView()
        {
            InitializeComponent();
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

        internal void Load(TaskItem task, bool loadTime = true)
        {
            RequireViewModel().Load(task);
            Visibility = Visibility.Visible;
            if (loadTime)
            {
                Run("load-task-time", () => RequireViewModel().LoadTimeAsync());
            }
        }

        internal void Refresh(TaskNotesState state)
        {
            TaskEditorViewModel viewModel = RequireViewModel();
            if (viewModel.TaskId is not string taskId)
            {
                return;
            }
            TaskItem? current = state.AllTasks.SingleOrDefault(task =>
                string.Equals(task.Id, taskId, StringComparison.Ordinal)
            );
            if (current is null)
            {
                Clear();
            }
            else if (!viewModel.IsDirty)
            {
                Load(current, loadTime: false);
            }
        }

        internal void Clear()
        {
            RequireViewModel().Clear();
            Visibility = Visibility.Collapsed;
        }

        internal async Task<bool> ConfirmDiscardAsync()
        {
            TaskEditorViewModel viewModel = RequireViewModel();
            if (!viewModel.IsDirty)
            {
                return true;
            }
            bool discard = await RequireConfirm()(
                "Discard unsaved changes?",
                "The task inspector has edits that have not been saved."
            );
            if (discard)
            {
                viewModel.Discard();
            }
            return discard;
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
                    if (await RequireConfirm()("Delete task?", $"Delete '{viewModel.Title}'?"))
                    {
                        await viewModel.DeleteAsync();
                        Clear();
                    }
                }
            );
        }

        private void ToggleTime_Click(object sender, RoutedEventArgs eventArgs)
        {
            _ = sender;
            _ = eventArgs;
            if (RequireViewModel().IsLoaded)
            {
                Run("toggle-time", () => RequireViewModel().ToggleTimeAsync());
            }
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
