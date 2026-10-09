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
        private long _inputGeneration;
        private bool _isSubmitting;
        private long? _confirmedGeneration;
        private string? _recoveryActionId;
        private bool _needsObservation;

        /// <summary>Exact admitted capture must be resumed or retired in existing Settings recovery.</summary>
        public string? RecoveryActionId
        {
            get => _recoveryActionId;
            private set
            {
                if (SetProperty(ref _recoveryActionId, value))
                    OnPropertyChanged(nameof(CanSubmit));
            }
        }

        /// <summary>Applied captures awaiting observation cannot be recreated.</summary>
        public bool NeedsObservation
        {
            get => _needsObservation;
            private set
            {
                if (SetProperty(ref _needsObservation, value))
                    OnPropertyChanged(nameof(CanSubmit));
            }
        }

        /// <summary>Initializes Quick Add over the store facade.</summary>
        public QuickAddViewModel(ITaskNotesStore store)
        {
            _store = store ?? throw new ArgumentNullException(nameof(store));
        }

        /// <summary>Gets or sets natural-language input.</summary>
        public string Input
        {
            get => _input;
            set
            {
                if (SetProperty(ref _input, value))
                {
                    _inputGeneration++;
                    OnPropertyChanged(nameof(CanSubmit));
                }
            }
        }

        /// <summary>Capture feedback is local; it never disables unrelated task actions.</summary>
        public bool IsSubmitting
        {
            get => _isSubmitting;
            private set
            {
                if (SetProperty(ref _isSubmitting, value))
                    OnPropertyChanged(nameof(CanSubmit));
            }
        }

        /// <summary>Only a nonblank capture can be offered.</summary>
        public bool CanSubmit =>
            !IsSubmitting
            && RecoveryActionId is null
            && !NeedsObservation
            && _confirmedGeneration != _inputGeneration
            && !string.IsNullOrWhiteSpace(Input);

        /// <summary>Clear a reviewed draft only after its exact retained action leaves recovery.</summary>
        public bool DiscardDraft()
        {
            if (
                IsSubmitting
                || RecoveryActionId is string id
                    && _store.State.FacetPendingActions.Any(action => action.Id == id)
            )
            {
                ValidationError =
                    "Resume or retire the submitted action in Settings recovery before clearing this capture.";
                return false;
            }
            RecoveryActionId = null;
            NeedsObservation = false;
            Input = "";
            Preview = null;
            ValidationError = null;
            return true;
        }

        /// <summary>Core-parsed preview fields as native chip labels.</summary>
        public IReadOnlyList<string> PreviewChips =>
            Preview is not { } preview
                ? []
                :
                [
                    .. (preview.Due is null ? Array.Empty<string>() : [$"Due {preview.Due}"]),
                    preview.Priority,
                    .. preview.Projects,
                    .. preview.Contexts.Select(value => $"@{value}"),
                    .. preview.Tags.Select(value => $"#{value}"),
                    .. (preview.Recurrence is null ? Array.Empty<string>() : [preview.Recurrence]),
                ];

        /// <summary>Gets the core-generated preview.</summary>
        public QuickAddPreview? Preview
        {
            get => _preview;
            private set
            {
                if (SetProperty(ref _preview, value))
                {
                    OnPropertyChanged(nameof(PreviewDescription));
                    OnPropertyChanged(nameof(PreviewChips));
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
            long generation = _inputGeneration;
            string input = Input;
            if (string.IsNullOrWhiteSpace(Input))
            {
                Preview = null;
                ValidationError = "Enter a task before previewing it.";
                return false;
            }
            var preview = await _store.PreviewQuickAddAsync(input, cancellationToken);
            if (generation != _inputGeneration)
                return false;
            Preview = preview;
            ValidationError = null;
            return true;
        }

        /// <summary>Saves input and optionally resets for another task.</summary>
        public async Task<bool> SaveAsync(
            bool addAnother,
            CancellationToken cancellationToken = default
        )
        {
            string input = Input;
            long generation = _inputGeneration;
            TaskListQuery context = _context;
            var capture = _store as IFacetCaptureStore;
            string? profile = capture?.SelectedProfileId;
            if (string.IsNullOrWhiteSpace(input))
            {
                ValidationError = "Enter a task before saving it.";
                return false;
            }
            if (!CanSubmit)
                return false;
            IsSubmitting = true;
            string? admitted = null;
            try
            {
                cancellationToken.ThrowIfCancellationRequested();
                var preview = await _store.PreviewQuickAddAsync(input, cancellationToken);
                if (generation == _inputGeneration)
                {
                    Preview = preview;
                    ValidationError = null;
                }
                if (capture is not null)
                    await capture.AddCaptureAsync(
                        input,
                        context,
                        profile,
                        id => admitted = id,
                        cancellationToken
                    );
                else
                    await _store.AddAsync(input, context, cancellationToken);
                _confirmedGeneration = generation;
                if (addAnother && generation == _inputGeneration)
                {
                    Input = string.Empty;
                    Preview = null;
                }
                return true;
            }
            catch (FacetSavedObservationException)
            {
                RecoveryActionId = admitted;
                NeedsObservation = true;
                ValidationError =
                    "The capture was applied but could not be observed. Refresh or review its exact action in Settings recovery; it will not be created again.";
                return false;
            }
            catch
            {
                if (admitted is not null)
                {
                    RecoveryActionId = admitted;
                    ValidationError =
                        "The submitted capture has an uncertain result. Resume or retire its exact action in Settings recovery; newer text is retained.";
                }
                throw;
            }
            finally
            {
                IsSubmitting = false;
            }
        }
    }
}
