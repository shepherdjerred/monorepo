using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.App.Views
{
    /// <summary>Compiled Quick Add input and preview over the portable model.</summary>
    public sealed partial class QuickAddView : UserControl
    {
        /// <summary>Identifies the portable view-model dependency property.</summary>
        public static readonly DependencyProperty ViewModelProperty = DependencyProperty.Register(
            nameof(ViewModel),
            typeof(QuickAddViewModel),
            typeof(QuickAddView),
            new PropertyMetadata(null)
        );

        private UiOperationQueue? _operations;
        private Func<Func<Task>, Task<bool>>? _execute;

        /// <summary>Initializes the compiled Quick Add view.</summary>
        public QuickAddView()
        {
            InitializeComponent();
        }

        /// <summary>Gets or sets portable Quick Add state.</summary>
        public QuickAddViewModel? ViewModel
        {
            get => GetValue(ViewModelProperty) is QuickAddViewModel viewModel ? viewModel : null;
            set => SetValue(ViewModelProperty, value);
        }

        internal void Initialize(UiOperationQueue operations, Func<Func<Task>, Task<bool>> execute)
        {
            _operations = operations ?? throw new ArgumentNullException(nameof(operations));
            _execute = execute ?? throw new ArgumentNullException(nameof(execute));
        }

        internal void FocusInput()
        {
            _ = InputTextBox.Focus(FocusState.Programmatic);
        }

        private void Input_TextChanged(object sender, TextChangedEventArgs eventArgs)
        {
            _ = eventArgs;
            QuickAddViewModel viewModel = RequireViewModel();
            viewModel.Input = ((TextBox)sender).Text;
            UiOperationQueue operations =
                _operations
                ?? throw new InvalidOperationException("Initialize the Quick Add operation queue.");
            Func<Func<Task>, Task<bool>> execute =
                _execute
                ?? throw new InvalidOperationException("Initialize the Quick Add executor.");
            operations.Run(
                "preview-quick-add",
                async () =>
                {
                    _ = await execute(async () =>
                    {
                        _ = await viewModel.PreviewAsync();
                    });
                }
            );
        }

        private QuickAddViewModel RequireViewModel() =>
            ViewModel ?? throw new InvalidOperationException("Attach the Quick Add view model.");
    }
}
