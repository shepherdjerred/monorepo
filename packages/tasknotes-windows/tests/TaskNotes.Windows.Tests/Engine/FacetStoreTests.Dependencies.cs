using System.Reflection;
using System.Text.Json;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Tests;

public sealed partial class FacetStoreTests
{
    private const string DependencyNote = """
        ---
        title: Dependency subject
        id: subject
        status: open
        priority: normal
        tags: [task]
        dateCreated: '2026-10-03T12:00:00Z'
        dateModified: '2026-10-03T12:00:00Z'
        blockedBy: [{"uid":"[[Tasks/first, task|Alias]]","reltype":"STARTTOSTART","gap":"-PT15M","vendor":{"exact":9007199254740993,"values":["a,b"]}},{"uid":"second","reltype":"FINISHTOFINISH","vendor":true}]
        externalNumber: 9007199254740993
        ---
        **Original body** [[Reference]]

        """;

    /// <summary>Actual Windows row additions reach Rust as valid structured dependencies for each core relationship.</summary>
    [TestMethod]
    [DataRow("FINISHTOSTART")]
    [DataRow("STARTTOSTART")]
    [DataRow("FINISHTOFINISH")]
    [DataRow("STARTTOFINISH")]
    public async Task DependencyRowsApplyThroughTheNativeMutation(string relationship)
    {
        using Fixture fixture = new();
        fixture.Seed("subject.md", DependencyNote);
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        using TaskEditorViewModel editor = new(store, new Dispatcher());
        editor.Load(store.State.AllTasks.Single());
        await editor.LoadDependencyMetadataAsync(TestContext.CancellationToken);
        editor.AddDependency();
        var added = editor.Dependencies.Last();
        Assert.AreEqual("", added.RelationType);
        added.Uid = "[[Tasks/new, reference|Keep alias]]";
        added.RelationType = relationship;
        added.Gap = "P1D";
        Assert.IsTrue(await editor.CommitFieldAsync("blockedBy", TestContext.CancellationToken));
        var dependencies = store.State.AllTasks.Single().Properties!.Value.GetProperty("blockedBy");
        Assert.AreEqual(3, dependencies.GetArrayLength());
        Assert.AreEqual(relationship, dependencies[2].GetProperty("reltype").GetString());
        Assert.AreEqual(added.Uid, dependencies[2].GetProperty("uid").GetString());
        Assert.AreEqual("P1D", dependencies[2].GetProperty("gap").GetString());
        Assert.AreEqual(
            "9007199254740993",
            dependencies[0].GetProperty("vendor").GetProperty("exact").GetRawText()
        );
        StringAssert.Contains(
            await File.ReadAllTextAsync(
                Path.Combine(fixture.Root, "subject.md"),
                TestContext.CancellationToken
            ),
            "**Original body** [[Reference]]",
            StringComparison.Ordinal
        );
    }

    /// <summary>Changing one identifier retains relation, gap, sibling and exact numeric extensions through Rust and Markdown.</summary>
    [TestMethod]
    public async Task DependencyEditAndRemovalPreserveUntouchedMetadata()
    {
        using Fixture fixture = new();
        fixture.Seed("subject.md", DependencyNote);
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        var original = store.State.AllTasks.Single();
        string sibling = original.Properties!.Value.GetProperty("blockedBy")[1].GetRawText();
        using TaskEditorViewModel editor = new(store, new Dispatcher());
        editor.Load(original);
        await editor.LoadDependencyMetadataAsync(TestContext.CancellationToken);
        byte[] originalBytes = await File.ReadAllBytesAsync(
            Path.Combine(fixture.Root, "subject.md"),
            TestContext.CancellationToken
        );
        string originalUid = editor.Dependencies[0].Uid;
        editor.Dependencies[0].Uid = "Temporary draft";
        editor.Dependencies[0].Uid = originalUid;
        Assert.IsTrue(await editor.SaveAsync(TestContext.CancellationToken));
        Assert.AreSequenceEqual(
            originalBytes,
            await File.ReadAllBytesAsync(
                Path.Combine(fixture.Root, "subject.md"),
                TestContext.CancellationToken
            )
        );
        editor.Dependencies[0].Uid = "[[Tasks/changed, reference|New alias]]";
        Assert.IsTrue(await editor.SaveAsync(TestContext.CancellationToken));
        var saved = store.State.AllTasks.Single().Properties!.Value;
        var first = saved.GetProperty("blockedBy")[0];
        Assert.AreEqual("STARTTOSTART", first.GetProperty("reltype").GetString());
        Assert.AreEqual("-PT15M", first.GetProperty("gap").GetString());
        Assert.AreEqual(
            "9007199254740993",
            first.GetProperty("vendor").GetProperty("exact").GetRawText()
        );
        Assert.AreEqual(sibling, saved.GetProperty("blockedBy")[1].GetRawText());
        Assert.AreEqual("9007199254740993", saved.GetProperty("externalNumber").GetRawText());
        editor.Dependencies[0].Gap = "";
        Assert.IsTrue(await editor.CommitFieldAsync("blockedBy", TestContext.CancellationToken));
        Assert.IsFalse(
            store
                .State.AllTasks.Single()
                .Properties!.Value.GetProperty("blockedBy")[0]
                .TryGetProperty("gap", out _)
        );
        editor.RemoveDependency(editor.Dependencies[0]);
        editor.RemoveDependency(editor.Dependencies[0]);
        Assert.IsTrue(await editor.SaveAsync(TestContext.CancellationToken));
        Assert.AreEqual(
            0,
            store
                .State.AllTasks.Single()
                .Properties!.Value.GetProperty("blockedBy")
                .GetArrayLength()
        );
    }

    /// <summary>Add uses the owning vault's explicit core-projected default rather than a platform assumption.</summary>
    [TestMethod]
    public async Task DependencyAdditionUsesTheCoreConfiguredDefault()
    {
        using Fixture fixture = new();
        fixture.Seed("tasknotes.yaml", "dependencies:\n  default_reltype: STARTTOFINISH\n");
        fixture.Seed("subject.md", DependencyNote);
        await using var store = fixture.Open();
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        using TaskEditorViewModel editor = new(store, new Dispatcher());
        editor.Load(store.State.AllTasks.Single());
        await editor.LoadDependencyMetadataAsync(TestContext.CancellationToken);
        editor.AddDependency();
        Assert.AreEqual("STARTTOFINISH", editor.Dependencies.Last().RelationType);
        editor.Dependencies.Last().Uid = "new-configured-dependency";
        Assert.IsTrue(await editor.CommitFieldAsync("blockedBy", TestContext.CancellationToken));
        Assert.AreEqual(
            "STARTTOFINISH",
            store
                .State.AllTasks.Single()
                .Properties!.Value.GetProperty("blockedBy")[2]
                .GetProperty("reltype")
                .GetString()
        );
    }

    /// <summary>Readable unsupported values permit explicit repair; schema-invalid source remains a typed read failure with unchanged bytes.</summary>
    [TestMethod]
    [DataRow("\"legacy dependency list\"", false)]
    [DataRow("{\"legacy\":true}", true)]
    [DataRow("[{\"uid\":\"legacy\",\"reltype\":\"UNKNOWN\",\"vendor\":true}]", true)]
    public async Task ExistingDependencyRepairHonorsTheNativeReadBoundary(
        string existing,
        bool nativeReadable
    )
    {
        using Fixture fixture = new();
        string note = string.Join(
            '\n',
            DependencyNote
                .Split('\n')
                .Select(line =>
                    line.StartsWith("blockedBy:", StringComparison.Ordinal)
                        ? "blockedBy: " + existing
                        : line
                )
        );
        fixture.Seed("subject.md", note);
        await using var store = fixture.Open();
        if (!nativeReadable)
        {
            byte[] before = await File.ReadAllBytesAsync(
                Path.Combine(fixture.Root, "subject.md"),
                TestContext.CancellationToken
            );
            _ = await Assert.ThrowsExactlyAsync<Core.FacetEngineException.Validation>(() =>
                store.InitializeAsync(null, null, TestContext.CancellationToken)
            );
            Assert.AreSequenceEqual(
                before,
                await File.ReadAllBytesAsync(
                    Path.Combine(fixture.Root, "subject.md"),
                    TestContext.CancellationToken
                )
            );
            return;
        }
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        using TaskEditorViewModel editor = new(store, new Dispatcher());
        editor.Load(store.State.AllTasks.Single());
        await editor.LoadDependencyMetadataAsync(TestContext.CancellationToken);
        Assert.IsFalse(editor.IsDirty);
        if (editor.CanReplaceDependencyList)
            editor.ReplaceDependencyList();
        else
        {
            Assert.IsFalse(editor.Dependencies.Single().IsEditable);
            editor.RemoveDependency(editor.Dependencies.Single());
        }
        editor.AddDependency();
        editor.Dependencies.Single().Uid = "repaired reference";
        editor.Dependencies.Single().RelationType = "STARTTOSTART";
        Assert.IsTrue(await editor.CommitFieldAsync("blockedBy", TestContext.CancellationToken));
        Assert.AreEqual(
            "repaired reference",
            store
                .State.AllTasks.Single()
                .Properties!.Value.GetProperty("blockedBy")[0]
                .GetProperty("uid")
                .GetString()
        );
    }

    /// <summary>The Android production serializer's captured command applies unchanged through the typed native engine.</summary>
    [TestMethod]
    public async Task AndroidDependencyCommandAppliesThroughTheNativeEngine()
    {
        using var resource = Assembly
            .GetExecutingAssembly()
            .GetManifestResourceStream("AndroidDependencyEditCommand.json")!;
        using var packet = await JsonDocument.ParseAsync(
            resource,
            cancellationToken: TestContext.CancellationToken
        );
        var value = packet.RootElement;
        using Fixture fixture = new();
        string path = value.GetProperty("path").GetString()!;
        fixture.Seed(path, value.GetProperty("note").GetString()!);
        await using (var store = fixture.Open())
        {
            await store.InitializeAsync(null, null, TestContext.CancellationToken);
            string expectedRevision = value
                .GetProperty("command")
                .GetProperty("expectedRevision")
                .GetString()!;
            string? actualRevision = store.State.AllTasks.Single().ExpectedRevision;
            Assert.AreEqual(expectedRevision, actualRevision);
        }
        await using (
            var engine = FacetPortableCapability.Open(
                fixture.DatabasePath,
                [new FacetFolderCapability("p", fixture.Root, true)]
            )
        )
        {
            await engine.InitializeAsync(TestContext.CancellationToken);
            string mutation = JsonSerializer.Serialize(
                new
                {
                    schemaVersion = 1,
                    mutationId = "android-dependency-packet",
                    at = "2026-10-26T12:00:00Z",
                    command = value.GetProperty("command"),
                }
            );
            using var receipt = JsonDocument.Parse(
                await engine.ExecuteAsync("p", mutation, TestContext.CancellationToken)
            );
            Assert.IsTrue(receipt.RootElement.GetProperty("applied").GetBoolean());
        }
        await using var reopened = fixture.Open();
        await reopened.InitializeAsync(null, null, TestContext.CancellationToken);
        var properties = reopened.State.AllTasks.Single().Properties!.Value;
        var dependencies = properties.GetProperty("blockedBy");
        Assert.AreEqual(
            "[[Tasks/new, reference|Alias]]",
            dependencies[0].GetProperty("uid").GetString()
        );
        Assert.AreEqual("STARTTOSTART", dependencies[0].GetProperty("reltype").GetString());
        Assert.AreEqual("-PT15M", dependencies[0].GetProperty("gap").GetString());
        Assert.AreEqual(
            "9007199254740993",
            dependencies[0].GetProperty("vendor").GetProperty("integer").GetRawText()
        );
        Assert.IsTrue(dependencies[1].GetProperty("vendor").GetBoolean());
        Assert.AreEqual("9007199254740993", properties.GetProperty("externalNumber").GetRawText());
    }
}
