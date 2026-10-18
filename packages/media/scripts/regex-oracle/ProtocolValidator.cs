using System.Text.Json;

// Implements exactly the JSON Schema keywords used by the embedded canonical protocol.
// Unknown keywords fail closed so extending the schema requires updating both consumers.
static class ProtocolValidator
{
    public static void Validate(JsonElement value, JsonElement schema)
    {
        foreach (var keyword in schema.EnumerateObject())
        {
            switch (keyword.Name)
            {
                case "type": CheckType(value, keyword.Value.GetString()); break;
                case "const": Require(JsonElement.DeepEquals(value, keyword.Value)); break;
                case "enum": Require(keyword.Value.EnumerateArray().Any(item => JsonElement.DeepEquals(item, value))); break;
                case "maxLength": Require(value.GetString()!.Length <= keyword.Value.GetInt32()); break;
                case "minLength": Require(value.GetString()!.Length >= keyword.Value.GetInt32()); break;
                case "maxItems": Require(value.GetArrayLength() <= keyword.Value.GetInt32()); break;
                case "items": foreach (var item in value.EnumerateArray()) Validate(item, keyword.Value); break;
                case "required": foreach (var key in keyword.Value.EnumerateArray()) Require(value.TryGetProperty(key.GetString()!, out _)); break;
                case "properties": ValidateProperties(value, keyword.Value); break;
                case "additionalProperties":
                    Require(keyword.Value.ValueKind == JsonValueKind.False);
                    var properties = schema.GetProperty("properties");
                    foreach (var key in value.EnumerateObject()) Require(properties.TryGetProperty(key.Name, out _));
                    break;
                default: throw new InvalidOperationException("Unsupported canonical schema keyword");
            }
        }
    }
    static void ValidateProperties(JsonElement value, JsonElement properties)
    {
        foreach (var property in properties.EnumerateObject())
            if (value.TryGetProperty(property.Name, out var item)) Validate(item, property.Value);
    }
    static void CheckType(JsonElement value, string? type) => Require(type switch {
        "object" => value.ValueKind == JsonValueKind.Object,
        "array" => value.ValueKind == JsonValueKind.Array,
        "string" => value.ValueKind == JsonValueKind.String,
        _ => throw new InvalidOperationException("Unsupported canonical schema type")
    });
    static void Require(bool valid)
    {
        if (!valid) throw new InvalidOperationException("Regex protocol validation failed");
    }
}
