using System.Text.Json;

namespace TaskNotes.Windows.Host;

/// <summary>Native presentation ownership captured before a mutation starts.</summary>
public sealed record FacetNoticeOwner(
    string ProfileId,
    string MutationId,
    long RequestGeneration,
    long EngineGeneration
);

/// <summary>A saved notice remains separate from mutation or maintenance errors.</summary>
public sealed record FacetSavedNotice(FacetNoticeOwner Owner, IReadOnlyList<string> Messages)
{
    /// <summary>Gets plain confirmation copy for the applied operation.</summary>
    public string Title { get; } = "Saved";

    /// <summary>Allows publication only while the exact native owner remains current.</summary>
    public bool BelongsTo(FacetNoticeOwner current) => Owner == current;
}

/// <summary>Decodes required closed warning codes after full shared receipt validation.</summary>
public static class FacetReceiptWarnings
{
    /// <summary>Validates the full receipt and prepares fixed copy without changing its outcome.</summary>
    public static FacetSavedNotice? Read(
        FacetSchema schema,
        string receiptJson,
        FacetNoticeOwner owner
    )
    {
        schema.Validate(receiptJson, "receipt");
        using var document = JsonDocument.Parse(receiptJson);
        var receipt = document.RootElement;
        if (receipt.GetProperty("mutationId").GetString() != owner.MutationId)
            throw new InvalidDataException("The native receipt belongs to another action.");
        var diagnostics = receipt.GetProperty("diagnostics");
        if (diagnostics.ValueKind != JsonValueKind.Array || diagnostics.GetArrayLength() > 3)
            throw new InvalidDataException("The native warning contract is invalid.");
        HashSet<string> seen = new(StringComparer.Ordinal);
        List<string> messages = [];
        foreach (var item in diagnostics.EnumerateArray())
        {
            if (
                item.ValueKind != JsonValueKind.Object
                || item.EnumerateObject().Count() != 1
                || !item.TryGetProperty("code", out var code)
                || code.ValueKind != JsonValueKind.String
                || !seen.Add(code.GetString()!)
            )
                throw new InvalidDataException("The native warning contract is invalid.");
            messages.Add(
                code.GetString() switch
                {
                    "template_missing" => "The task was saved without the configured template.",
                    "template_parse_failed" => "The configured template could not be used.",
                    "filename_shortened" => "Facet shortened the filename and kept the full title.",
                    _ => throw new InvalidDataException("The native warning code is unknown."),
                }
            );
        }
        return receipt.GetProperty("applied").GetBoolean() && messages.Count > 0
            ? new FacetSavedNotice(owner, messages.AsReadOnly())
            : null;
    }
}
