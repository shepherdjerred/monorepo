using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
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
        internal event RoutedEventHandler? SubmitRequested;

        /// <summary>Initializes the compiled Quick Add view.</summary>
        public QuickAddView()
        {
            InitializeComponent();
            Loaded += (_, _) => FocusInput();
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

        private void Input_KeyDown(object sender, KeyRoutedEventArgs args)
        {
            _ = sender;
            if (
                args.Key == global::Windows.System.VirtualKey.Enter
                && RequireViewModel().CanSubmit
                && SubmitRequested is not null
            )
            {
                args.Handled = true;
                SubmitRequested.Invoke(this, args);
            }
        }

        private void Discard_Click(object sender, RoutedEventArgs args)
        {
            _ = sender;
            _ = args;
            _ = RequireViewModel().DiscardDraft();
            FocusInput();
        }

        private void Input_TextChanged(object sender, TextChangedEventArgs eventArgs)
        {
            _ = eventArgs;
            QuickAddViewModel viewModel = RequireViewModel();
            viewModel.Input = ((TextBox)sender).Text;
            QueuePreview();
        }

        internal void CommitTokens()
        {
            foreach (var input in new[] { ProjectsInput, ContextsInput, TagsInput })
            {
                if (!string.IsNullOrWhiteSpace(input.Text))
                    RequireViewModel().AddToken((string)input.Tag, input.Text);
                input.Text = "";
            }
        }

        private void Token_QuerySubmitted(
            AutoSuggestBox sender,
            AutoSuggestBoxQuerySubmittedEventArgs args
        )
        {
            RequireViewModel()
                .AddToken((string)sender.Tag, args.ChosenSuggestion as string ?? args.QueryText);
            sender.Text = "";
            QueuePreview();
        }

        private void RemoveChip_Click(object sender, RoutedEventArgs args)
        {
            _ = args;
            RequireViewModel().RemoveChip((CaptureChip)((Button)sender).Tag);
            QueuePreview();
        }

        private void ClearBody_Click(object sender, RoutedEventArgs args)
        {
            _ = sender;
            _ = args;
            RequireViewModel().ClearBody();
        }

        private void DetailsDate_Changed(
            CalendarDatePicker sender,
            CalendarDatePickerDateChangedEventArgs args
        )
        {
            _ = sender;
            _ = args;
            if (IsLoaded)
                QueuePreview();
        }

        private void DetailsPriority_Changed(object sender, SelectionChangedEventArgs args)
        {
            _ = sender;
            _ = args;
            if (IsLoaded)
                QueuePreview();
        }

        private void QueuePreview()
        {
            QuickAddViewModel viewModel = RequireViewModel();
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
