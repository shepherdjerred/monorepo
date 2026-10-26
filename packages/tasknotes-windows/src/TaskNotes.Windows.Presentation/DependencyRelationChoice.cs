namespace TaskNotes.Windows.Presentation;

/// <summary>A changed native selection is bound to its editor owner, metadata reading and row instance.</summary>
public sealed class DependencyRelationChoice
{
    internal DependencyRelationChoice(
        TaskEditorViewModel owner,
        long generation,
        long metadataRequest,
        DependencyEditorRow row
    )
    {
        Owner = owner;
        Generation = generation;
        MetadataRequest = metadataRequest;
        Row = row;
    }

    internal TaskEditorViewModel Owner { get; }
    internal long Generation { get; }
    internal long MetadataRequest { get; }
    internal DependencyEditorRow Row { get; }
}

public sealed partial class TaskEditorViewModel
{
    /// <summary>Captures a ready changed selection from pointer, keyboard or accessibility input.</summary>
    public DependencyRelationChoice? CaptureDependencyRelationChoice(
        DependencyEditorRow row,
        string? relationship
    ) =>
        !_disposed
        && _dependencyMetadata is not null
        && Dependencies.Contains(row)
        && row.IsEditable
        && relationship is not null
        && relationship != row.RelationType
        && _dependencyMetadata.RelationshipTypes.Contains(relationship, StringComparer.Ordinal)
            ? new(this, _ownerGeneration, _dependencyRequest, row)
            : null;

    /// <summary>A queued commit must still belong to the captured owner and metadata reading.</summary>
    public bool OwnsDependencyRelationChoice(
        DependencyRelationChoice choice,
        DependencyEditorRow row
    ) =>
        !_disposed
        && ReferenceEquals(choice.Owner, this)
        && choice.Generation == _ownerGeneration
        && choice.MetadataRequest == _dependencyRequest
        && ReferenceEquals(choice.Row, row)
        && _dependencyMetadata is not null
        && Dependencies.Contains(row)
        && row.IsEditable;

    /// <summary>Applies a supported changed selection while its captured owner is still ready.</summary>
    public bool ApplyDependencyRelationChoice(
        DependencyRelationChoice choice,
        DependencyEditorRow row,
        string relationship
    )
    {
        if (!OwnsDependencyRelationChoice(choice, row))
            return false;
        if (!_dependencyMetadata!.RelationshipTypes.Contains(relationship, StringComparer.Ordinal))
            return false;
        if (row.RelationType == relationship)
            return false;
        row.RelationType = relationship;
        return true;
    }
}
