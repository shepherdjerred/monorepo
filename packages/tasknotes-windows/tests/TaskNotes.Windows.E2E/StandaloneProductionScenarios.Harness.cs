using System.Text.Json;
using TaskNotes.Windows.App.Acceptance;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.E2E;

public sealed partial class StandaloneProductionScenarios
{
    /// <summary>Exercises current standalone accessible properties, keyboard focus and native announcements.</summary>
    [TestMethod, TestCategory("accessibility-keyboard")]
    public async Task StandaloneAccessibility()
    {
        var cancellation = TestContext.CancellationToken;
        var run = await LaunchRunAsync(cancellation);
        await using var session = run.Session;
        List<string> passed = [];
        await AccessibilityAsync(session, passed, cancellation);
        await WriteEvidenceAsync(run.Descriptor, "accessibility-keyboard", passed, cancellation);
    }

    private static async Task<(
        StandaloneAcceptanceDescriptor Descriptor,
        UiAutomationSession Session,
        string Results
    )> LaunchRunAsync(CancellationToken cancellation)
    {
        string family = Required("FACET_ACCEPTANCE_PACKAGE_FAMILY");
        string descriptorPath = Required("FACET_ACCEPTANCE_DESCRIPTOR");
        var descriptor = StandaloneAcceptanceDescriptor.Read(
            descriptorPath,
            Required("FACET_ACCEPTANCE_LOCAL_STATE"),
            family,
            await File.ReadAllTextAsync(
                Path.Combine(AppContext.BaseDirectory, "Acceptance", "contract.json"),
                cancellation
            )
        );
        string results = Path.Combine(descriptor.StateDirectory, "results");
        StandaloneAcceptanceDescriptor.RequireUnlinkedPath(results);
        var session = await UiAutomationSession.LaunchStandaloneAsync(
            descriptor,
            Required("FACET_ACCEPTANCE_EXECUTABLE"),
            descriptorPath,
            cancellation
        );
        return (descriptor, session, results);
    }

    private static async Task WriteEvidenceAsync(
        StandaloneAcceptanceDescriptor descriptor,
        string scenario,
        IReadOnlyCollection<string> assertions,
        CancellationToken cancellation
    )
    {
        var schema = new FacetSchema(
            await File.ReadAllTextAsync(
                Path.Combine(AppContext.BaseDirectory, "Acceptance", "contract.json"),
                cancellation
            )
        );
        string manifestJson = await File.ReadAllTextAsync(
            Path.Combine(AppContext.BaseDirectory, "Acceptance", "scenarios.json"),
            cancellation
        );
        schema.Validate(manifestJson, "scenarioManifest");
        using var manifest = JsonDocument.Parse(manifestJson);
        var expected = manifest
            .RootElement.GetProperty("scenarios")
            .GetProperty(scenario)
            .EnumerateArray()
            .Select(value => value.GetString()!)
            .Order(StringComparer.Ordinal)
            .ToArray();
        CollectionAssert.AreEqual(
            expected,
            assertions.Order(StringComparer.Ordinal).ToArray(),
            "Native runtime proof must cover the exact neutral assertion inventory, without omissions or duplicates."
        );
        string evidence = JsonSerializer.Serialize(
            new
            {
                schemaVersion = 1,
                runId = descriptor.RunId,
                scenario,
                composition = "FacetTaskNotesStore",
                completed = true,
                assertions,
            }
        );
        schema.Validate(evidence, "runtimeEvidence");
        await File.WriteAllTextAsync(
            Path.Combine(descriptor.StateDirectory, "results", "evidence.json"),
            evidence,
            cancellation
        );
    }
}
