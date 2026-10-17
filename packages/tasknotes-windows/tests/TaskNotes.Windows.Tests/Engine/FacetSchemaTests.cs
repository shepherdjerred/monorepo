using System.Text.Json;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>Language-neutral producer and consumer contract evidence.</summary>
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

    /// <summary>Runs every positive and negative shared boundary case.</summary>
    [TestMethod]
    public void SharedNeutralCorpusIsFullyValidated() =>
        ValidateCorpus("FacetContractCases.json", "value", 35);

    /// <summary>Raw shared numeric literals retain exact values across the language boundary.</summary>
    [TestMethod]
    public void SharedRawNumericCorpusIsFullyValidated() =>
        ValidateCorpus("FacetRawContractCases.json", "raw", 7);

    /// <summary>Historical private drafts do not restore removed public commands.</summary>
    [TestMethod]
    public void HistoricalPrivateActionCorpusIsFullyValidated()
    {
        ValidateCorpus("FacetRetainedActionCases.json", "value", 14);
        using var stream = typeof(FacetSchemaTests).Assembly.GetManifestResourceStream(
            "FacetRetainedActionCases.json"
        )!;
        using var document = JsonDocument.Parse(stream);
        var schema = FacetSchema.Bundled();
        foreach (var fixture in document.RootElement.GetProperty("cases").EnumerateArray())
            if (fixture.GetProperty("valid").GetBoolean())
            {
                var mutation = fixture.GetProperty("value");
                Assert.IsFalse(FacetRetainedActions.CanResume(mutation));
                _ = Assert.ThrowsExactly<InvalidDataException>(() =>
                    schema.Validate(mutation.GetRawText(), "mutation")
                );
            }
    }

    private static void ValidateCorpus(string resource, string property, int minimumCases)
    {
        using var stream = typeof(FacetSchemaTests).Assembly.GetManifestResourceStream(resource)!;
        using var document = JsonDocument.Parse(stream);
        var schema = FacetSchema.Bundled();
        int count = 0;
        foreach (var fixture in document.RootElement.GetProperty("cases").EnumerateArray())
        {
            string id = fixture.GetProperty("id").GetString()!;
            string definition = fixture.GetProperty("definition").GetString()!;
            string value =
                property == "raw"
                    ? fixture.GetProperty(property).GetString()!
                    : fixture.GetProperty(property).GetRawText();
            if (fixture.GetProperty("valid").GetBoolean())
                schema.Validate(value, definition);
            else
                _ = Assert.ThrowsExactly<InvalidDataException>(
                    () => schema.Validate(value, definition),
                    id
                );
            count++;
        }
        Assert.IsTrue(count >= minimumCases, "The shared corpus must not silently shrink.");
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

    /// <summary>Unsupported schema policy and duplicate JSON fields fail loudly.</summary>
    [TestMethod]
    public void UnknownKeywordsAndDuplicateFieldsAreRejected()
    {
        _ = Assert.ThrowsExactly<InvalidDataException>(() =>
            new FacetSchema("""{"$defs":{"test":{"multipleOf":2}}}""")
        );
        _ = Assert.ThrowsExactly<InvalidDataException>(() =>
            FacetSchema.Bundled().Validate("""{"scope":"all","scope":"today"}""", "query")
        );
    }
}
