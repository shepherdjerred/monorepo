using System.Text.Json;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>New feature projections remain native-owned, validated and durable across replay.</summary>
[TestClass]
public sealed class FacetFeatureTests
{
    /// <summary>Partial failure keeps the applied child, exposes both outcomes and replays without duplicating work.</summary>
    [TestMethod]
    public async Task NativeFeatureReadsExposePartialOutcomesAndCachedProviderReadiness()
    {
        using TemporaryDirectory directory = new();
        string physical =
            OperatingSystem.IsMacOS()
            && directory.Path.StartsWith("/var/", StringComparison.Ordinal)
                ? "/private" + directory.Path
                : directory.Path;
        string root = Path.Combine(physical, "replica");
        Directory.CreateDirectory(Path.Combine(root, ".obsidian", "plugins", "tasknotes"));
        await File.WriteAllTextAsync(
            Path.Combine(root, ".obsidian/plugins/tasknotes/data.json"),
            "{\"storeTitleInFilename\":false}",
            TestContext.CancellationToken
        );
        string note = Path.Combine(root, "review.md");
        await File.WriteAllTextAsync(
            note,
            "---\ntitle: Reviewed\nstatus: open\npriority: normal\ndateCreated: '2026-10-03T12:00:00Z'\ntags: [task]\nexternalNumber: 9007199254740993\n---\nBody\n",
            TestContext.CancellationToken
        );
        await using FacetEngineService engine = FacetPortableCapability.Open(
            Path.Combine(physical, "facet.sqlite"),
            [new FacetFolderCapability("p", root, true)]
        );
        await engine.InitializeAsync(TestContext.CancellationToken);
        await engine.RegisterProfileAsync(
            "p",
            "Private",
            root,
            true,
            true,
            TestContext.CancellationToken
        );
        await engine.RefreshAsync("p", TestContext.CancellationToken);
        using var conformance = JsonDocument.Parse(
            await engine.FeaturesAsync(
                "p",
                "{\"kind\":\"conformance\"}",
                TestContext.CancellationToken
            )
        );
        var providers = conformance.RootElement.GetProperty("configurationProviders");
        Assert.AreEqual("cached", providers.GetProperty("state").GetString());
        Assert.AreEqual("plugin-data-json", providers.GetProperty("selected").GetString());
        Assert.AreEqual("none", providers.GetProperty("fallback").GetString());
        using var preview = JsonDocument.Parse(
            await engine.FeaturesAsync(
                "p",
                "{\"kind\":\"normalization_preview\",\"path\":\"review.md\"}",
                TestContext.CancellationToken
            )
        );
        Assert.AreEqual(
            "9007199254740993",
            preview
                .RootElement.GetProperty("frontmatter")
                .GetProperty("externalNumber")
                .GetRawText()
        );
        const string mutation = """
            {"schemaVersion":1,"mutationId":"partial-reviewed","at":"2026-10-03T12:01:00Z","command":{"kind":"batch_partial","commands":[{"kind":"edit_task","path":"review.md","properties":{"title":"Changed"}},{"kind":"edit_task","path":"missing.md","properties":{"title":"Missing"}}]}}
            """;
        string receipt = await engine.ExecuteAsync("p", mutation, TestContext.CancellationToken);
        const string request = "{\"kind\":\"batch_outcome\",\"mutationId\":\"partial-reviewed\"}";
        string outcome = await engine.FeaturesAsync("p", request, TestContext.CancellationToken);
        using var result = JsonDocument.Parse(outcome);
        Assert.AreEqual(2, result.RootElement.GetProperty("total").GetInt32());
        Assert.AreEqual(1, result.RootElement.GetProperty("succeeded").GetInt32());
        Assert.AreEqual(1, result.RootElement.GetProperty("failed").GetInt32());
        var items = result.RootElement.GetProperty("items");
        Assert.IsTrue(items[0].GetProperty("applied").GetBoolean());
        Assert.IsFalse(items[1].GetProperty("applied").GetBoolean());
        Assert.IsNotNull(items[1].GetProperty("error").GetString());
        byte[] appliedBytes = await File.ReadAllBytesAsync(note, TestContext.CancellationToken);
        Assert.AreEqual(
            receipt,
            await engine.ExecuteAsync("p", mutation, TestContext.CancellationToken)
        );
        Assert.AreEqual(
            outcome,
            await engine.FeaturesAsync("p", request, TestContext.CancellationToken)
        );
        CollectionAssert.AreEqual(
            appliedBytes,
            await File.ReadAllBytesAsync(note, TestContext.CancellationToken)
        );
        Assert.IsFalse(File.Exists(Path.Combine(root, "missing.md")));
    }

    /// <summary>Framework cancellation for native and filesystem operations.</summary>
    public TestContext TestContext { get; set; } = null!;
}
