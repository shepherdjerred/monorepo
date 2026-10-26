using System.Text.Json;

namespace TaskNotes.Windows.Host;

/// <summary>Core-authored dependency choices and the selected vault's optional default.</summary>
public sealed record DependencyEditorMetadata(
    IReadOnlyList<string> RelationshipTypes,
    string? DefaultReltype
);

/// <summary>Reads dependency editor metadata for an explicit owning vault.</summary>
public interface IFacetDependencyEditorStore
{
    /// <summary>Returns validated core metadata without writing or selecting another vault.</summary>
    Task<DependencyEditorMetadata> ReadDependencyEditorMetadataAsync(
        string profileId,
        CancellationToken cancellationToken = default
    );
}

public sealed partial class FacetTaskNotesStore : IFacetDependencyEditorStore
{
    /// <inheritdoc />
    public Task<DependencyEditorMetadata> ReadDependencyEditorMetadataAsync(
        string profileId,
        CancellationToken cancellationToken = default
    ) =>
        SerializedAsync(
            async () =>
            {
                using var document = JsonDocument.Parse(
                    await _engine
                        .FeaturesAsync(
                            profileId,
                            "{\"schemaVersion\":1,\"kind\":\"dependency_editor\"}",
                            cancellationToken
                        )
                        .ConfigureAwait(false)
                );
                var value = document.RootElement;
                string[] choices = value
                    .GetProperty("relationshipTypes")
                    .EnumerateArray()
                    .Select(item => item.GetString()!)
                    .ToArray();
                string? configured = value.GetProperty("defaultReltype").GetString();
                if (
                    choices.Length == 0
                    || choices.Distinct(StringComparer.Ordinal).Count() != choices.Length
                    || (
                        configured is not null
                        && !choices.Contains(configured, StringComparer.Ordinal)
                    )
                )
                    throw new InvalidDataException(
                        "The dependency editor metadata violates its contract."
                    );
                return new DependencyEditorMetadata(choices, configured);
            },
            cancellationToken
        );
}
