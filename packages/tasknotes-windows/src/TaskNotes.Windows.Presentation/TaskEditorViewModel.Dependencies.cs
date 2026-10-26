using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Presentation;

public sealed partial class TaskEditorViewModel
{
    private DependencyEditorMetadata? _dependencyMetadata;
    private long _dependencyRequest;
    private string? _dependencyMetadataError;

    /// <summary>New rows require core metadata for this loaded vault.</summary>
    public bool CanAddDependency =>
        IsLoaded && _dependencyMetadata is not null && !CanReplaceDependencyList;

    /// <summary>Metadata failures preserve the draft and expose an explicit retry.</summary>
    public string? DependencyMetadataError
    {
        get => _dependencyMetadataError;
        private set
        {
            if (SetProperty(ref _dependencyMetadataError, value))
                OnPropertyChanged(nameof(HasDependencyMetadataError));
        }
    }

    /// <summary>Retry appears only when dependency metadata needs attention.</summary>
    public bool HasDependencyMetadataError => DependencyMetadataError is not null;

    private IReadOnlyList<WorkflowChoice> DependencyChoices =>
        _dependencyMetadata
            ?.RelationshipTypes.Select(value => new WorkflowChoice(value, RelationshipLabel(value)))
            .ToArray()
        ?? [];

    private static string RelationshipLabel(string value)
    {
        string words = string.Concat(value.Select(char.ToLowerInvariant))
            .Replace("to", " to ", StringComparison.Ordinal);
        return char.ToUpperInvariant(words[0]) + words[1..];
    }

    /// <summary>Loads native metadata away from the UI thread, fencing late responses by editor owner.</summary>
    public async Task LoadDependencyMetadataAsync(CancellationToken cancellationToken = default)
    {
        var original =
            _original
            ?? throw new InvalidOperationException("Load a task before its dependency metadata.");
        long owner = _ownerGeneration;
        long request = ++_dependencyRequest;
        _dependencyMetadata = null;
        DependencyMetadataError = null;
        foreach (var row in Dependencies)
            row.MetadataPending();
        OnPropertyChanged(nameof(CanAddDependency));
        try
        {
            if (_store is not IFacetDependencyEditorStore source)
                throw new InvalidOperationException(
                    "The store does not provide dependency editor metadata."
                );
            string profileId =
                original.ProfileId
                ?? throw new ArgumentException(
                    "Select the task's owning vault before loading dependency relationships."
                );
            var metadata = await source.ReadDependencyEditorMetadataAsync(
                profileId,
                cancellationToken
            );
            if (_disposed || owner != _ownerGeneration || request != _dependencyRequest)
                return;
            _dependencyMetadata = metadata;
            DependencyMetadataError = null;
            foreach (var row in Dependencies)
                row.SetChoices(DependencyChoices);
            OnPropertyChanged(nameof(CanAddDependency));
        }
        catch (Exception error)
        {
            string? message = TaskNotesExceptionPolicy.UserFacingMessage(error);
            if (message is null)
                throw;
            if (!_disposed && owner == _ownerGeneration && request == _dependencyRequest)
                DependencyMetadataError = message;
        }
    }

    private void ResetDependencyMetadata()
    {
        _dependencyRequest++;
        _dependencyMetadata = null;
        DependencyMetadataError = null;
        OnPropertyChanged(nameof(CanAddDependency));
    }
}
