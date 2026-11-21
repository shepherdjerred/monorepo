using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;
using Windows.ApplicationModel.DataTransfer;

namespace TaskNotes.Windows.App.Views
{
    /// <summary>Native board input adapter over the portable shell view model.</summary>
    public sealed partial class BoardView : UserControl
    {
        /// <summary>Identifies the portable view-model dependency property.</summary>
        public static readonly DependencyProperty ViewModelProperty = DependencyProperty.Register(
            nameof(ViewModel),
            typeof(ShellViewModel),
            typeof(BoardView),
            new PropertyMetadata(null)
        );

        private UiOperationQueue? _operations;
        private Func<Func<Task>, Task<bool>>? _execute;
        private TaskItem? _draggedTask;

        /// <summary>Initializes the compiled board view.</summary>
        public BoardView()
        {
            InitializeComponent();
        }

        /// <summary>Gets or sets the portable board state.</summary>
        public ShellViewModel? ViewModel
        {
            get => GetValue(ViewModelProperty) is ShellViewModel viewModel ? viewModel : null;
            set => SetValue(ViewModelProperty, value);
        }

        internal void Initialize(UiOperationQueue operations, Func<Func<Task>, Task<bool>> execute)
        {
            _operations = operations ?? throw new ArgumentNullException(nameof(operations));
            _execute = execute ?? throw new ArgumentNullException(nameof(execute));
        }

        private void Refresh_Click(object sender, RoutedEventArgs eventArgs)
        {
            _ = sender;
            _ = eventArgs;
            Run("refresh-board", () => RequireViewModel().RefreshCommand.ExecuteAsync(null));
        }

        private void Board_DragItemsStarting(object sender, DragItemsStartingEventArgs eventArgs)
        {
            _ = sender;
            _draggedTask = null;
            if (eventArgs.Items.FirstOrDefault() is TaskItem task)
            {
                _draggedTask = task;
                eventArgs.Data.SetText(task.Id);
                eventArgs.Data.RequestedOperation = DataPackageOperation.Move;
            }
        }

        private void Board_DragItemsCompleted(object sender, DragItemsCompletedEventArgs eventArgs)
        {
            _ = sender;
            _ = eventArgs;
            _draggedTask = null;
        }

        private void AdvanceBoardTask_Click(object sender, RoutedEventArgs eventArgs)
        {
            _ = eventArgs;
            if (sender is not FrameworkElement { Tag: TaskItem task })
            {
                return;
            }

            var columns = RequireViewModel().BoardColumns;
            if (columns.Count == 0)
                throw new InvalidOperationException("No board columns are configured.");
            int index = -1;
            for (int i = 0; i < columns.Count; i++)
            {
                if (columns[i].Tasks.Any(item => item.Id == task.Id))
                {
                    index = i;
                    break;
                }
            }
            string targetColumn = columns[(index + 1) % columns.Count].Value;
            Run("advance-board-task", () =>
                RequireViewModel().MoveBoardTaskAsync(task, targetColumn)
            );
        }

        private void Board_Drop(object sender, DragEventArgs eventArgs)
        {
            if (
                sender is not ListView { Tag: string status }
                || !eventArgs.DataView.Contains(StandardDataFormats.Text)
                || _draggedTask is not TaskItem task
            )
            {
                return;
            }

            _draggedTask = null;
            Run("board-drop", async () =>
            {
                string taskId = await eventArgs.DataView.GetTextAsync();
                if (taskId != task.Id)
                    return;
                await RequireViewModel().MoveBoardTaskAsync(task, status);
                eventArgs.AcceptedOperation = DataPackageOperation.Move;
            });
        }

        private void Run(string operationName, Func<Task> operation)
        {
            UiOperationQueue operations = _operations
                ?? throw new InvalidOperationException("Initialize the board operation queue.");
            Func<Func<Task>, Task<bool>> execute = _execute
                ?? throw new InvalidOperationException("Initialize the board executor.");
            operations.Run(operationName, async () =>
            {
                _ = await execute(operation);
            });
        }

        private ShellViewModel RequireViewModel() =>
            ViewModel ?? throw new InvalidOperationException("Attach the board view model.");
    }
}
