using System.Text.Json;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>Native presentation must cover every closed enum produced by the shared schema, without exposing raw implementation codes.</summary>
[TestClass]
public sealed class FacetOccurrencePresentationContractTests
{
    /// <summary>Adding a core problem code without usable native copy fails this shared-contract check.</summary>
    [TestMethod]
    public void EveryCoreMaintenanceProblemHasNativePresentationAndUnknownCodesFail()
    {
        using var schema = Schema();
        var codes = schema
            .RootElement.GetProperty("$defs")
            .GetProperty("rollingMaintenancePlan")
            .GetProperty("properties")
            .GetProperty("problems")
            .GetProperty("items")
            .GetProperty("properties")
            .GetProperty("code")
            .GetProperty("enum");
        Assert.IsGreaterThan(0, codes.GetArrayLength());
        foreach (var value in codes.EnumerateArray())
        {
            string code = value.GetString()!;
            string message = new FacetOccurrenceProblem("p", "Parent.md", code).Summary;
            Assert.IsFalse(string.IsNullOrWhiteSpace(message));
            Assert.AreNotEqual(
                code,
                message,
                "Internal core enums must not be the user-facing repair guidance."
            );
        }
        _ = Assert.ThrowsExactly<InvalidDataException>(() =>
        {
            _ = new FacetOccurrenceProblem("p", "Parent.md", "future_unknown_code").Summary;
        });
    }

    /// <summary>All producer states and nonrepairable reasons remain distinguishable after restart; unknown states never fall through.</summary>
    [TestMethod]
    public void EveryCoreGenerationStateAndRepairReasonHasNativePresentation()
    {
        using var schema = Schema();
        var definitions = schema.RootElement.GetProperty("$defs");
        var states = definitions
            .GetProperty("concreteOccurrenceSuccessor")
            .GetProperty("properties")
            .GetProperty("state")
            .GetProperty("enum");
        foreach (var state in states.EnumerateArray())
        {
            var row = Outcome(state.GetString()!, null);
            Assert.IsFalse(string.IsNullOrWhiteSpace(row.Status));
            Assert.AreNotEqual(row.State, row.Status);
            Assert.IsFalse(row.CanRepair);
        }
        var reasons = definitions
            .GetProperty("generationFailuresPlan")
            .GetProperty("properties")
            .GetProperty("items")
            .GetProperty("items")
            .GetProperty("properties")
            .GetProperty("action")
            .GetProperty("oneOf")[1]
            .GetProperty("properties")
            .GetProperty("reason")
            .GetProperty("enum");
        foreach (var reason in reasons.EnumerateArray())
        {
            var row = Outcome("failed", reason.GetString());
            Assert.IsFalse(string.IsNullOrWhiteSpace(row.Status));
            Assert.AreNotEqual(row.UnrepairableReason, row.Status);
            Assert.IsFalse(row.CanRepair);
        }
        _ = Assert.ThrowsExactly<InvalidDataException>(() =>
        {
            _ = Outcome("future_unknown_state", null).Status;
        });
        _ = Assert.ThrowsExactly<InvalidDataException>(() =>
        {
            _ = Outcome("failed", "future_unknown_reason").Status;
        });
    }

    private static FacetGenerationFailure Outcome(string state, string? reason) =>
        new(
            "p",
            "primary",
            "successor",
            "Parent.md",
            "materialize_occurrence",
            state,
            null,
            null,
            reason
        );

    private static JsonDocument Schema()
    {
        using var stream =
            typeof(FacetSchema).Assembly.GetManifestResourceStream("FacetEngineSchema.json")
            ?? throw new InvalidDataException("The producer schema is missing.");
        return JsonDocument.Parse(stream);
    }
}
