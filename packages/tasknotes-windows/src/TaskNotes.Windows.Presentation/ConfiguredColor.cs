using System.Globalization;
using System.Text.Json;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Presentation;

/// <summary>Portable CSS RGBA value; native controls retain semantic contrast behavior.</summary>
public sealed record ConfiguredColor(byte Red, byte Green, byte Blue, byte Alpha)
{
    private static readonly Dictionary<string, string> Names = ReadNames();

    /// <summary>Parse only the shared policy; unsupported configured values remain unchanged in the vault.</summary>
    public static ConfiguredColor? Parse(string? raw)
    {
        if (raw is null)
            return null;
        string text = raw.Trim();
        if (Names.TryGetValue(text, out var named))
            text = named;
        if (
            !text.StartsWith('#')
            || text.Length is not (4 or 5 or 7 or 9)
            || !text.AsSpan(1).ToArray().All(Uri.IsHexDigit)
        )
            return null;
        string hex = text[1..];
        if (hex.Length is 3 or 4)
            hex = string.Concat(hex.Select(value => new string(value, 2)));
        if (hex.Length == 6)
            hex += "ff";
        byte Part(int offset) =>
            byte.Parse(hex.AsSpan(offset, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        return new(Part(0), Part(2), Part(4), Part(6));
    }

    /// <summary>Per-choice diagnostic; absence of a configured color needs no warning.</summary>
    public static string Diagnostic(string? raw) =>
        raw is not null && Parse(raw) is null
            ? $"Unsupported configured color '{raw}'. This choice uses the native neutral color; its vault value is preserved."
            : "";

    private static Dictionary<string, string> ReadNames()
    {
        string Read(string name)
        {
            using var stream =
                typeof(ConfiguredColor).Assembly.GetManifestResourceStream(name)
                ?? throw new InvalidDataException("The shared color contract is missing.");
            using var reader = new StreamReader(stream);
            return reader.ReadToEnd();
        }
        string json = Read("PresentationColorPolicy.json");
        new FacetSchema(Read("PresentationSchema.json")).Validate(json, "colorPolicy");
        using var document = JsonDocument.Parse(json);
        return document
            .RootElement.GetProperty("namedColors")
            .EnumerateObject()
            .ToDictionary(
                pair => pair.Name,
                pair => pair.Value.GetString()!,
                StringComparer.OrdinalIgnoreCase
            );
    }
}
