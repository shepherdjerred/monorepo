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
            if (eventArgs.Items.FirstOrDefault() is TaskItem task)
            {
                eventArgs.Data.SetText(task.Id);
                eventArgs.Data.RequestedOperation = DataPackageOperation.Move;
            }
        }

        private void AdvanceBoardTask_Click(object sender, RoutedEventArgs eventArgs)
        {
            _ = eventArgs;
            if (
                sender is not FrameworkElement { Tag: string taskId }
                || RequireViewModel()
                    .State.AllTasks.SingleOrDefault(task =>
                        string.Equals(task.Id, taskId, StringComparison.Ordinal)
                    )
                    is not TaskItem task
            )
            {
                return;
            }

            string status = task.Status switch
            {
                "open" => "in-progress",
                "in-progress" => "waiting",
                "waiting" => "delegated",
                "delegated" => "done",
                "done" or "cancelled" => "open",
                _ => throw new InvalidOperationException($"Unknown board status '{task.Status}'."),
            };
            Run("advance-board-task", () => RequireViewModel().MoveBoardTaskAsync(taskId, status));
        }

        private void Board_Drop(object sender, DragEventArgs eventArgs)
        {
            if (
                sender is not ListView { Tag: string status }
                || !eventArgs.DataView.Contains(StandardDataFormats.Text)
            )
            {
                return;
            }

            Run(
                "board-drop",
                async () =>
                {
                    string taskId = await eventArgs.DataView.GetTextAsync();
                    await RequireViewModel().MoveBoardTaskAsync(taskId, status);
                    eventArgs.AcceptedOperation = DataPackageOperation.Move;
                }
            );
        }

        private void Run(string operationName, Func<Task> operation)
        {
            UiOperationQueue operations =
                _operations
                ?? throw new InvalidOperationException("Initialize the board operation queue.");
            Func<Func<Task>, Task<bool>> execute =
                _execute ?? throw new InvalidOperationException("Initialize the board executor.");
            operations.Run(
                operationName,
                async () =>
                {
                    _ = await execute(operation);
                }
            );
        }

        private ShellViewModel RequireViewModel() =>
            ViewModel ?? throw new InvalidOperationException("Attach the board view model.");
    }
}
