using System.Text.Json;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Presentation;

/// <summary>Validated shared presentation roles; Windows supplies native semantic brushes.</summary>
public sealed class PresentationTokens
{
    private readonly JsonElement _tokens;

    /// <summary>Validate the complete shared token contract, including unknown and missing roles.</summary>
    public PresentationTokens(string json, string schema)
    {
        new FacetSchema(schema).Validate(json, "tokens");
        using var document = JsonDocument.Parse(json);
        _tokens = document.RootElement.Clone();
    }

    /// <summary>Load the single language-neutral source bundled into the presentation assembly.</summary>
    public static PresentationTokens Bundled() =>
        new(Read("PresentationTokens.json"), Read("PresentationSchema.json"));

    /// <summary>Read a numeric role from the validated contract.</summary>
    public double Number(params string[] path)
    {
        JsonElement value = _tokens;
        foreach (string key in path)
            value = value.GetProperty(key);
        return value.GetDouble();
    }

    /// <summary>The complete set of semantic color roles, resolved by native resources.</summary>
    public IReadOnlyList<string> ColorRoles =>
        _tokens
            .GetProperty("colorRoles")
            .EnumerateArray()
            .Select(role => role.GetString()!)
            .ToArray();

    private static string Read(string name)
    {
        using var stream =
            typeof(PresentationTokens).Assembly.GetManifestResourceStream(name)
            ?? throw new InvalidDataException("The shared presentation contract is missing.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
