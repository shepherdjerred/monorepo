using System.Globalization;
using System.Numerics;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TaskNotes.Windows.Host;

/// <summary>Validates the shared JSON Schema at the native boundary.</summary>
public sealed class FacetSchema
{
    private readonly JsonElement _definitions;
    private static readonly HashSet<string> Supported = new(StringComparer.Ordinal)
    {
        "$ref",
        "$schema",
        "$id",
        "$defs",
        "$comment",
        "title",
        "description",
        "default",
        "examples",
        "const",
        "enum",
        "anyOf",
        "oneOf",
        "allOf",
        "not",
        "type",
        "properties",
        "required",
        "additionalProperties",
        "propertyNames",
        "minProperties",
        "maxProperties",
        "items",
        "minItems",
        "maxItems",
        "uniqueItems",
        "minLength",
        "maxLength",
        "pattern",
        "format",
        "minimum",
        "maximum",
    };

    /// <summary>Read a schema, rejecting unsupported validation keywords.</summary>
    public FacetSchema(string json)
    {
        using var document = JsonDocument.Parse(json);
        _definitions = document.RootElement.GetProperty("$defs").Clone();
        foreach (var definition in _definitions.EnumerateObject())
            Inspect(definition.Value);
    }

    /// <summary>Load the embedded shared source, with no language-owned copy.</summary>
    public static FacetSchema Bundled() => Resource("FacetEngineSchema.json");

    internal static FacetSchema Sync() => Resource("FacetSyncSchema.json");

    private static FacetSchema Resource(string name)
    {
        using var stream =
            typeof(FacetSchema).Assembly.GetManifestResourceStream(name)
            ?? throw new InvalidDataException("The shared Facet schema is missing.");
        using var reader = new StreamReader(stream);
        return new FacetSchema(reader.ReadToEnd());
    }

    /// <summary>Check one versioned input or output definition.</summary>
    public void Validate(string json, string definition)
    {
        using var document = JsonDocument.Parse(json);
        UniqueKeys(document.RootElement);
        Check(_definitions.GetProperty(definition), document.RootElement);
    }

    private static void Require(bool valid)
    {
        if (!valid)
            throw new InvalidDataException(
                "The Facet contract document is invalid or unsupported."
            );
    }

    private static void UniqueKeys(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            HashSet<string> keys = new(StringComparer.Ordinal);
            foreach (var field in value.EnumerateObject())
            {
                Require(keys.Add(field.Name));
                UniqueKeys(field.Value);
            }
        }
        else if (value.ValueKind == JsonValueKind.Array)
            foreach (var child in value.EnumerateArray())
                UniqueKeys(child);
    }

    private static void Inspect(JsonElement rule)
    {
        if (rule.ValueKind is JsonValueKind.True or JsonValueKind.False)
            return;
        Require(rule.ValueKind == JsonValueKind.Object);
        foreach (var field in rule.EnumerateObject())
            Require(Supported.Contains(field.Name));
        foreach (string keyword in new[] { "properties", "$defs" })
            if (rule.TryGetProperty(keyword, out var children))
                foreach (var child in children.EnumerateObject())
                    Inspect(child.Value);
        foreach (
            string keyword in new[] { "items", "not", "additionalProperties", "propertyNames" }
        )
            if (rule.TryGetProperty(keyword, out var child))
                Inspect(child);
        foreach (string keyword in new[] { "anyOf", "oneOf", "allOf" })
            if (rule.TryGetProperty(keyword, out var children))
                foreach (var child in children.EnumerateArray())
                    Inspect(child);
        if (rule.TryGetProperty("format", out var format))
            Require(format.GetString() is "date" or "date-time");
    }

    private void Check(JsonElement rule, JsonElement value)
    {
        if (rule.ValueKind == JsonValueKind.True)
            return;
        if (rule.ValueKind == JsonValueKind.False)
        {
            Require(false);
            return;
        }
        if (rule.TryGetProperty("$ref", out var reference))
        {
            string path = reference.GetString()!;
            Require(path.StartsWith("#/$defs/", StringComparison.Ordinal));
            Check(_definitions.GetProperty(path[8..]), value);
        }
        if (rule.TryGetProperty("const", out var constant))
            Require(Equal(constant, value));
        if (rule.TryGetProperty("enum", out var values))
            Require(values.EnumerateArray().Any(candidate => Equal(candidate, value)));
        if (rule.TryGetProperty("allOf", out var all))
            foreach (var child in all.EnumerateArray())
                Check(child, value);
        if (rule.TryGetProperty("not", out var excluded))
            Require(!Matches(excluded, value));
        foreach (string keyword in new[] { "anyOf", "oneOf" })
            if (rule.TryGetProperty(keyword, out var alternatives))
            {
                int count = alternatives
                    .EnumerateArray()
                    .Count(candidate => Matches(candidate, value));
                Require(keyword == "oneOf" ? count == 1 : count > 0);
            }
        if (rule.TryGetProperty("type", out var type))
            Require(
                type.ValueKind == JsonValueKind.Array
                    ? type.EnumerateArray().Any(t => TypeMatches(t.GetString(), value))
                    : TypeMatches(type.GetString(), value)
            );
        if (value.ValueKind == JsonValueKind.Object)
        {
            int count = value.EnumerateObject().Count();
            if (rule.TryGetProperty("minProperties", out var minimumProperties))
                Require(count >= minimumProperties.GetDecimal());
            if (rule.TryGetProperty("maxProperties", out var maximumProperties))
                Require(count <= maximumProperties.GetDecimal());
            rule.TryGetProperty("properties", out var properties);
            if (rule.TryGetProperty("required", out var required))
                foreach (var key in required.EnumerateArray())
                    Require(value.TryGetProperty(key.GetString()!, out _));
            foreach (var field in value.EnumerateObject())
            {
                if (rule.TryGetProperty("propertyNames", out var names))
                    Check(names, JsonSerializer.SerializeToElement(field.Name));
                if (
                    properties.ValueKind == JsonValueKind.Object
                    && properties.TryGetProperty(field.Name, out var property)
                )
                    Check(property, field.Value);
                else if (rule.TryGetProperty("additionalProperties", out var additional))
                    Check(additional, field.Value);
            }
        }
        if (value.ValueKind == JsonValueKind.Array)
        {
            if (rule.TryGetProperty("items", out var items))
                foreach (var child in value.EnumerateArray())
                    Check(items, child);
            if (rule.TryGetProperty("minItems", out var minimum))
                Require(value.GetArrayLength() >= minimum.GetDecimal());
            if (rule.TryGetProperty("maxItems", out var maximum))
                Require(value.GetArrayLength() <= maximum.GetDecimal());
            if (rule.TryGetProperty("uniqueItems", out var unique) && unique.GetBoolean())
            {
                var children = value.EnumerateArray().ToArray();
                for (int i = 0; i < children.Length; i++)
                for (int j = 0; j < i; j++)
                    Require(!Equal(children[i], children[j]));
            }
        }
        if (value.ValueKind == JsonValueKind.String)
        {
            string text = value.GetString()!;
            int length = text.EnumerateRunes().Count();
            if (rule.TryGetProperty("minLength", out var minimum))
                Require(length >= minimum.GetDecimal());
            if (rule.TryGetProperty("maxLength", out var maximum))
                Require(length <= maximum.GetDecimal());
            if (rule.TryGetProperty("pattern", out var pattern))
                Require(
                    Regex.IsMatch(
                        text,
                        pattern.GetString()!,
                        RegexOptions.CultureInvariant,
                        TimeSpan.FromSeconds(1)
                    )
                );
            if (rule.TryGetProperty("format", out var format))
                Require(
                    format.GetString() == "date"
                        ? DateOnly.TryParseExact(
                            text,
                            "yyyy-MM-dd",
                            CultureInfo.InvariantCulture,
                            DateTimeStyles.None,
                            out _
                        )
                        : Regex.IsMatch(
                            text,
                            @"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$",
                            RegexOptions.CultureInvariant,
                            TimeSpan.FromSeconds(1)
                        )
                            && DateTimeOffset.TryParse(
                                text,
                                CultureInfo.InvariantCulture,
                                DateTimeStyles.None,
                                out _
                            )
                );
        }
        if (value.ValueKind == JsonValueKind.Number)
        {
            if (rule.TryGetProperty("minimum", out var minimum))
                Require(CompareNumbers(value, minimum) >= 0);
            if (rule.TryGetProperty("maximum", out var maximum))
                Require(CompareNumbers(value, maximum) <= 0);
        }
    }

    private bool Matches(JsonElement rule, JsonElement value)
    {
        try
        {
            Check(rule, value);
            return true;
        }
        catch (InvalidDataException)
        {
            return false;
        }
    }

    private static int CompareNumbers(JsonElement left, JsonElement right)
    {
        var a = ExactNumber.Parse(left.GetRawText());
        var b = ExactNumber.Parse(right.GetRawText());
        if (a.Sign != b.Sign)
            return a.Sign.CompareTo(b.Sign);
        if (a.Sign == 0)
            return 0;
        int magnitude = (a.Exponent + a.Digits.Length).CompareTo(b.Exponent + b.Digits.Length);
        if (magnitude != 0)
            return a.Sign * magnitude;
        int width = Math.Max(a.Digits.Length, b.Digits.Length);
        return a.Sign
            * StringComparer.Ordinal.Compare(
                a.Digits.PadRight(width, '0'),
                b.Digits.PadRight(width, '0')
            );
    }

    private readonly record struct ExactNumber(int Sign, string Digits, BigInteger Exponent)
    {
        internal static ExactNumber Parse(string raw)
        {
            string[] parts = raw.Split('e', 'E');
            BigInteger exponent =
                parts.Length == 2
                    ? BigInteger.Parse(parts[1], CultureInfo.InvariantCulture)
                    : BigInteger.Zero;
            string mantissa = parts[0];
            int sign = mantissa.StartsWith('-') ? -1 : 1;
            if (sign < 0)
                mantissa = mantissa[1..];
            int dot = mantissa.IndexOf('.', StringComparison.Ordinal);
            if (dot >= 0)
                exponent -= mantissa.Length - dot - 1;
            string digits = mantissa.Replace(".", "", StringComparison.Ordinal).TrimStart('0');
            if (digits.Length == 0)
                return new ExactNumber(0, "0", BigInteger.Zero);
            int length = digits.TrimEnd('0').Length;
            exponent += digits.Length - length;
            return new ExactNumber(sign, digits[..length], exponent);
        }
    }

    private static bool Equal(JsonElement left, JsonElement right)
    {
        if (left.ValueKind == JsonValueKind.Number && right.ValueKind == JsonValueKind.Number)
            return CompareNumbers(left, right) == 0;
        if (left.ValueKind != right.ValueKind)
            return false;
        if (left.ValueKind == JsonValueKind.Object)
            return left.EnumerateObject().Count() == right.EnumerateObject().Count()
                && left.EnumerateObject()
                    .All(p => right.TryGetProperty(p.Name, out var child) && Equal(p.Value, child));
        if (left.ValueKind == JsonValueKind.Array)
            return left.GetArrayLength() == right.GetArrayLength()
                && left.EnumerateArray()
                    .Zip(right.EnumerateArray())
                    .All(pair => Equal(pair.First, pair.Second));
        return left.ValueKind == JsonValueKind.String
            ? left.GetString() == right.GetString()
            : left.GetRawText() == right.GetRawText();
    }

    private static bool TypeMatches(string? type, JsonElement value) =>
        type switch
        {
            "object" => value.ValueKind == JsonValueKind.Object,
            "array" => value.ValueKind == JsonValueKind.Array,
            "null" => value.ValueKind == JsonValueKind.Null,
            "string" => value.ValueKind == JsonValueKind.String,
            "boolean" => value.ValueKind is JsonValueKind.True or JsonValueKind.False,
            "number" => value.ValueKind == JsonValueKind.Number,
            "integer" => value.ValueKind == JsonValueKind.Number
                && ExactNumber.Parse(value.GetRawText()).Exponent >= BigInteger.Zero,
            _ => false,
        };
}
