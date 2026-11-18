using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>Language-neutral JSON schema validator contract evidence.</summary>
[TestClass]
public sealed class FacetSchemaTests
{
    /// <summary>Deep JSON equivalence honors property order, numeric values and unique array entries.</summary>
    [TestMethod]
    public void StructuredConstAndUniquenessUseExactDeepEquality()
    {
        var schema = new FacetSchema(
            """{"$defs":{"object":{"const":{"a":[1,null,true],"b":"text"}},"unique":{"type":"array","uniqueItems":true},"number":{"type":"number","minimum":-9007199254740993,"maximum":9007199254740993}}}"""
        );
        schema.Validate("{\"b\":\"text\",\"a\":[1e0,null,true]}", "object");
        schema.Validate("[{\"a\":1},{\"a\":2},false,true,null,\"1\",1]", "unique");
        foreach (
            string value in new[]
            {
                "[1,1.0]",
                "[{\"a\":1,\"b\":2},{\"b\":2e0,\"a\":1.0}]",
                "[[1,null],[1e0,null]]",
                "[null,null]",
                "[true,true]",
            }
        )
            _ = Assert.ThrowsExactly<InvalidDataException>(() => schema.Validate(value, "unique"));
        foreach (
            string value in new[]
            {
                "{\"a\":[1,null,false],\"b\":\"text\"}",
                "{\"a\":[1,null,true],\"b\":\"changed\"}",
                "{\"a\":[1,null,true],\"b\":\"text\",\"extra\":0}",
                "{\"a\":[1,null],\"b\":\"text\"}",
                "{\"a\":[\"1\",null,true],\"b\":\"text\"}",
            }
        )
            _ = Assert.ThrowsExactly<InvalidDataException>(() => schema.Validate(value, "object"));
        schema.Validate("-9007199254740993", "number");
        schema.Validate("0e100000", "number");
        schema.Validate("-0.0", "number");
        schema.Validate("-1e-100000", "number");
        schema.Validate("90071992547409930e-1", "number");
        _ = Assert.ThrowsExactly<InvalidDataException>(() =>
            schema.Validate("-9007199254740994", "number")
        );
        _ = Assert.ThrowsExactly<InvalidDataException>(() =>
            schema.Validate("9007199254740993.0000000001", "number")
        );
        _ = Assert.ThrowsExactly<InvalidDataException>(() => schema.Validate("\"2\"", "number"));
    }

    /// <summary>Validates combinators, references, strings, arrays, objects, enums, and booleans.</summary>
    [TestMethod]
    public void CombinatorsStringsObjectsAndReferencesEnforceAllConstraints()
    {
        var schema = new FacetSchema(
            """
            {
              "$defs": {
                "tag": { "type": "string", "minLength": 2, "maxLength": 5, "pattern": "^[a-z]+$" },
                "flag": { "type": "boolean" },
                "nullableText": { "type": ["string", "null"] },
                "choice": { "enum": ["alpha", "beta", 3] },
                "union": { "oneOf": [{ "$ref": "#/$defs/tag" }, { "$ref": "#/$defs/flag" }] },
                "either": { "anyOf": [{ "type": "integer", "minimum": 10 }, { "const": "ok" }] },
                "list": { "type": "array", "minItems": 1, "maxItems": 2, "items": { "$ref": "#/$defs/tag" } },
                "record": {
                  "type": "object",
                  "required": ["id"],
                  "additionalProperties": false,
                  "properties": {
                    "id": { "$ref": "#/$defs/tag" },
                    "opt": { "$ref": "#/$defs/nullableText" }
                  }
                },
                "openMap": {
                  "type": "object",
                  "additionalProperties": { "type": "boolean" }
                }
              }
            }
            """
        );

        schema.Validate("\"abc\"", "tag");
        _ = Assert.ThrowsExactly<InvalidDataException>(() => schema.Validate("\"a\"", "tag"));
        _ = Assert.ThrowsExactly<InvalidDataException>(() => schema.Validate("\"abcdef\"", "tag"));
        _ = Assert.ThrowsExactly<InvalidDataException>(() => schema.Validate("\"Abc\"", "tag"));

        schema.Validate("true", "flag");
        _ = Assert.ThrowsExactly<InvalidDataException>(() => schema.Validate("1", "flag"));

        schema.Validate("null", "nullableText");
        schema.Validate("\"text\"", "nullableText");
        _ = Assert.ThrowsExactly<InvalidDataException>(() =>
            schema.Validate("false", "nullableText")
        );

        schema.Validate("\"alpha\"", "choice");
        schema.Validate("3", "choice");
        _ = Assert.ThrowsExactly<InvalidDataException>(() =>
            schema.Validate("\"gamma\"", "choice")
        );

        schema.Validate("\"abc\"", "union");
        schema.Validate("false", "union");
        _ = Assert.ThrowsExactly<InvalidDataException>(() => schema.Validate("12", "union"));

        schema.Validate("10", "either");
        schema.Validate("\"ok\"", "either");
        _ = Assert.ThrowsExactly<InvalidDataException>(() => schema.Validate("9", "either"));

        schema.Validate("[\"ab\",\"cd\"]", "list");
        _ = Assert.ThrowsExactly<InvalidDataException>(() => schema.Validate("[]", "list"));
        _ = Assert.ThrowsExactly<InvalidDataException>(() =>
            schema.Validate("[\"ab\",\"cd\",\"ef\"]", "list")
        );

        schema.Validate("{\"id\":\"abc\",\"opt\":null}", "record");
        _ = Assert.ThrowsExactly<InvalidDataException>(() => schema.Validate("{}", "record"));
        _ = Assert.ThrowsExactly<InvalidDataException>(() =>
            schema.Validate("{\"id\":\"abc\",\"extra\":1}", "record")
        );

        schema.Validate("{\"x\":true,\"y\":false}", "openMap");
        _ = Assert.ThrowsExactly<InvalidDataException>(() =>
            schema.Validate("{\"x\":1}", "openMap")
        );
    }

    /// <summary>Exact decimal and exponent math does not round large or fractional JSON literals.</summary>
    [TestMethod]
    public void NumericBoundariesUseExactValues()
    {
        var schema = new FacetSchema(
            """{"$defs":{"one":{"const":9007199254740993},"integer":{"type":"integer"},"range":{"type":"integer","maximum":9223372036854775807}}}"""
        );
        schema.Validate("9007199254740993", "one");
        schema.Validate("90071992547409930e-1", "one");
        schema.Validate("1.0", "integer");
        schema.Validate("1e0", "integer");
        schema.Validate("9223372036854775807", "range");
        _ = Assert.ThrowsExactly<InvalidDataException>(() =>
            schema.Validate("9007199254740992", "one")
        );
        _ = Assert.ThrowsExactly<InvalidDataException>(() =>
            schema.Validate("9007199254740993.0000000000000000000000001", "integer")
        );
        _ = Assert.ThrowsExactly<InvalidDataException>(() =>
            schema.Validate("9223372036854775808", "range")
        );
        _ = Assert.ThrowsExactly<InvalidDataException>(() => schema.Validate("1e100000", "one"));
    }

    /// <summary>Unsupported schema policy, missing definitions, and duplicate JSON fields fail loudly.</summary>
    [TestMethod]
    public void UnknownKeywordsAndDuplicateFieldsAreRejected()
    {
        _ = Assert.ThrowsExactly<InvalidDataException>(() =>
            new FacetSchema("""{"$defs":{"test":{"multipleOf":2}}}""")
        );
        var schema = new FacetSchema(
            """{"$defs":{"query":{"type":"object","properties":{"scope":{"type":"string"}}}}}"""
        );
        _ = Assert.ThrowsExactly<InvalidDataException>(() =>
            schema.Validate("""{"scope":"all","scope":"today"}""", "query")
        );
        _ = Assert.ThrowsExactly<KeyNotFoundException>(() => schema.Validate("{}", "missing"));
        _ = Assert.Throws<System.Text.Json.JsonException>(() => schema.Validate("{bad", "query"));
    }
}
