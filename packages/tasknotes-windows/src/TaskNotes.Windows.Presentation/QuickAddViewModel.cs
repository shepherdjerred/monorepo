using CommunityToolkit.Mvvm.ComponentModel;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Presentation
{
    /// <summary>Portable Quick Add input, preview, and submission state.</summary>
    public sealed class QuickAddViewModel : ObservableObject
    {
        private readonly ITaskNotesStore _store;
        private string _input = string.Empty;
        private QuickAddPreview? _preview;
        private string? _validationError;
        private TaskListQuery _context = TaskListQuery.Today;

        /// <summary>Initializes Quick Add over the store facade.</summary>
        public QuickAddViewModel(ITaskNotesStore store)
        {
            _store = store ?? throw new ArgumentNullException(nameof(store));
        }

        /// <summary>Gets or sets natural-language input.</summary>
        public string Input
        {
            get => _input;
            set => SetProperty(ref _input, value);
        }

        /// <summary>Gets the core-generated preview.</summary>
        public QuickAddPreview? Preview
        {
            get => _preview;
            private set
            {
                if (SetProperty(ref _preview, value))
                {
                    OnPropertyChanged(nameof(PreviewDescription));
                }
            }
        }

        /// <summary>Gets the validation message.</summary>
        public string? ValidationError
        {
            get => _validationError;
            private set
            {
                if (SetProperty(ref _validationError, value))
                {
                    OnPropertyChanged(nameof(PreviewDescription));
                }
            }
        }

        /// <summary>Gets accessible preview text for the native Quick Add view.</summary>
        public string PreviewDescription
        {
            get
            {
                if (ValidationError is not null)
                {
                    return ValidationError;
                }
                if (Preview is not QuickAddPreview preview)
                {
                    return "Enter a task to preview its parsed fields.";
                }
                string due = preview.Due is null ? string.Empty : $" · due {preview.Due}";
                string recurrence = preview.Recurrence is null
                    ? string.Empty
                    : $" · {preview.Recurrence}";
                string taxonomy = string.Join(
                    " ",
                    preview.Projects.Concat(preview.Contexts).Concat(preview.Tags)
                );
                return $"{preview.Title}{due} · {preview.Priority}{recurrence}\n{taxonomy}".Trim();
            }
        }

        /// <summary>Sets contextual defaults for subsequent previews and submissions.</summary>
        public void SetContext(TaskListQuery context)
        {
            _context = context ?? throw new ArgumentNullException(nameof(context));
        }

        /// <summary>Refreshes the natural-language preview.</summary>
        public async Task<bool> PreviewAsync(CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(Input))
            {
                Preview = null;
                ValidationError = "Enter a task before previewing it.";
                return false;
            }
            Preview = await _store.PreviewQuickAddAsync(Input, cancellationToken);
            ValidationError = null;
            return true;
        }

        /// <summary>Saves input and optionally resets for another task.</summary>
        public async Task<bool> SaveAsync(
            bool addAnother,
            CancellationToken cancellationToken = default
        )
        {
            if (!await PreviewAsync(cancellationToken))
            {
                return false;
            }
            await _store.AddAsync(Input, _context, cancellationToken);
            if (addAnother)
            {
                Input = string.Empty;
                Preview = null;
            }
            return true;
        }
    }
}
