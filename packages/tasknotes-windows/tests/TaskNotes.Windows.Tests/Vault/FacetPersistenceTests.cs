using System.Text.Json;
using System.Text.Json.Nodes;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>Real local capability and immutable retry durability.</summary>
[TestClass]
public sealed class FacetPersistenceTests
{
    /// <summary>Restored remote rights require exact primitive kinds and a complete original vault identity, never coercion or partial ownership.</summary>
    [TestMethod]
    public void RemoteProfileCatalogRejectsIncompleteAndMistypedVaultRights()
    {
        using TemporaryDirectory directory = new();
        var catalog = new FacetProfileCatalog(directory.Path);
        catalog.Add(
            new FacetProfileRegistration(
                "remote",
                "Remote",
                directory.Path,
                true,
                true,
                "owner",
                new ObsidianVaultChoice(
                    "vault",
                    "Vault",
                    "sync.obsidian.md",
                    "",
                    "salt",
                    3,
                    false,
                    false
                )
            )
        );
        string path = Path.Combine(directory.Path, "profiles.json");
        var original = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
        Assert.AreEqual(
            "vault",
            new FacetProfileCatalog(directory.Path).Profiles.Single().Vault!.Id
        );
        Action<JsonObject>[] corruptions =
        [
            value => value["SchemaVersion"] = "1",
            value => value["SelectedId"] = false,
            value => value["DeviceId"] = null,
            value => value["Profiles"] = null,
            value => value["Profiles"]!.AsArray().Add(value["Profiles"]![0]!.DeepClone()),
            value => value["Profiles"]![0]!["AccountOwner"] = null,
            value => value["Profiles"]![0]!["AccountOwner"] = "",
            value => value["Profiles"]![0]!["Vault"] = null,
            value => value["Profiles"]![0]!["Vault"] = "vault",
            value => value["Profiles"]![0]!["PrivateReplica"] = false,
            value => value["Profiles"]![0]!["ApproveStandard"] = null,
            value => value["Profiles"]![0]!["Name"] = "",
            value => value["Profiles"]![0]!["RootPath"] = 7,
            value => value["Profiles"]![0]!["Id"] = null,
        ];
        foreach (var corrupt in corruptions)
            Reject(corrupt);
        foreach (
            string field in new[]
            {
                "Id",
                "Name",
                "Host",
                "Region",
                "Salt",
                "EncryptionVersion",
                "Managed",
                "Shared",
            }
        )
        {
            Reject(value => value["Profiles"]![0]!["Vault"]!.AsObject().Remove(field));
            Reject(value => value["Profiles"]![0]!["Vault"]![field] = null);
            Reject(value =>
                value["Profiles"]![0]!["Vault"]![field] =
                    field == "EncryptionVersion" ? JsonValue.Create("3") : JsonValue.Create(7)
            );
        }
        Reject(value => value["Profiles"]![0]!["Vault"]!["EncryptionVersion"] = 256);
        Reject(value => value["Profiles"]![0]!["Vault"]!["EncryptionVersion"] = 1.5);
        Reject(value => value["Profiles"]![0]!["Vault"]!["Unknown"] = true);
        File.WriteAllText(path, original.ToJsonString());
        var restored = new FacetProfileCatalog(directory.Path);
        Assert.AreEqual("owner", restored.Profiles.Single().AccountOwner);
        Assert.AreEqual((byte)3, restored.Profiles.Single().Vault!.EncryptionVersion);
        void Reject(Action<JsonObject> corrupt)
        {
            var value = original.DeepClone().AsObject();
            corrupt(value);
            File.WriteAllText(path, value.ToJsonString());
            byte[] before = File.ReadAllBytes(path);
            Assert.Throws<InvalidDataException>(() => new FacetProfileCatalog(directory.Path));
            CollectionAssert.AreEqual(before, File.ReadAllBytes(path));
        }
    }

    /// <summary>Historical absence remains valid; explicit null, unknown members and changed removal ownership fail visibly without rewriting bytes.</summary>
    [TestMethod]
    public void ProfileCatalogRejectsCorruptRemovalAndCapabilityShapes()
    {
        using TemporaryDirectory directory = new();
        var catalog = new FacetProfileCatalog(directory.Path);
        catalog.Add(
            new FacetProfileRegistration("a", "First", directory.Path, false, true, null, null)
        );
        catalog.BeginRemoval("a");
        string path = Path.Combine(directory.Path, "profiles.json");
        var original = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
        Action<JsonObject>[] corruptions =
        [
            value => value["RemovingProfiles"] = null,
            value =>
                value["RemovingProfiles"]!
                    .AsArray()
                    .Add(value["RemovingProfiles"]![0]!.DeepClone()),
            value => value["RemovingProfiles"]![0]!["RootPath"] = "another-root",
            value => value["Profiles"]![0]!["PrivateReplica"] = "false",
            value => value["Profiles"]![0]!["AccountOwner"] = "owner-without-vault",
            value =>
            {
                value["Profiles"]![0]!.AsObject().Remove("ApproveStandard");
                value["Profiles"]![0]!["Unknown"] = false;
            },
            value => value["Unknown"] = true,
        ];
        foreach (var corrupt in corruptions)
        {
            var value = original.DeepClone().AsObject();
            corrupt(value);
            File.WriteAllText(path, value.ToJsonString());
            byte[] before = File.ReadAllBytes(path);
            Assert.Throws<InvalidDataException>(() => new FacetProfileCatalog(directory.Path));
            CollectionAssert.AreEqual(before, File.ReadAllBytes(path));
        }
        original.Remove("RemovingProfiles");
        File.WriteAllText(path, original.ToJsonString());
        var historical = new FacetProfileCatalog(directory.Path);
        Assert.IsEmpty(historical.PendingRemovals);
        Assert.AreEqual("a", historical.SelectedId);
        historical.BeginRemoval("a");
        Assert.HasCount(1, historical.PendingRemovals);
    }

    /// <summary>Restart keeps the original removal owner through catalog commit and cleans only after explicit disposition.</summary>
    [TestMethod]
    public void ProfileRemovalIntentSurvivesSelectionAndCatalogCommit()
    {
        using TemporaryDirectory directory = new();
        FacetProfileCatalog profiles = new(directory.Path);
        var first = new FacetProfileRegistration(
            "a",
            "First",
            directory.Path,
            true,
            true,
            "owner",
            new ObsidianVaultChoice(
                "remote",
                "First",
                "sync.obsidian.md",
                "",
                "salt",
                0,
                false,
                false
            )
        );
        profiles.Add(first);
        profiles.Add(
            new FacetProfileRegistration("b", "Second", directory.Path, false, true, null, null)
        );
        profiles.Select("a");
        profiles.BeginRemoval("a");
        profiles.BeginRemoval("a");
        var prepared = new FacetProfileCatalog(directory.Path);
        Assert.AreEqual(first, prepared.PendingRemovals.Single());
        Assert.HasCount(2, prepared.Profiles);
        prepared.CommitRemoval("a");
        var applied = new FacetProfileCatalog(directory.Path);
        Assert.AreEqual("b", applied.SelectedId);
        Assert.HasCount(1, applied.Profiles);
        Assert.AreEqual(first, applied.PendingRemovals.Single());
        applied.FinishRemoval("a");
        applied.FinishRemoval("a");
        Assert.IsEmpty(new FacetProfileCatalog(directory.Path).PendingRemovals);
        Assert.Throws<InvalidDataException>(() => applied.CommitRemoval("b"));
    }

    /// <summary>Applied conflict retries remain possible after its metadata has disappeared.</summary>
    [TestMethod]
    public void DurableConflictDecisionRetainsAllFourFencesBeforeRetry()
    {
        using TemporaryDirectory directory = new();
        string hash = new('a', 64);
        const string request = "resolve_conflict:conflict-id:keep_local";
        FacetMutationJournal journal = new(directory.Path);
        var original = journal.Prepare(
            "p",
            new
            {
                kind = "resolve_conflict",
                conflictId = "conflict-id",
                expectedRevisions = new
                {
                    @base = hash,
                    local = hash,
                    remote = hash,
                    current = hash,
                },
                resolution = new { kind = "keep_local" },
            },
            request
        );
        FacetSchema.Bundled().Validate(original.Document, "mutation");
        var restored = new FacetMutationJournal(directory.Path);
        Assert.AreEqual(original, restored.Pending("p", request));
        Assert.IsNull(restored.Pending("another-profile", request));
        restored.Complete(original, false);
        Assert.IsNull(new FacetMutationJournal(directory.Path).Pending("p", request));
    }

    /// <summary>Selection and account authorization metadata survive a process restore.</summary>
    [TestMethod]
    public void ProfileSelectionRestoresWithoutCredentials()
    {
        using TemporaryDirectory directory = new();
        FacetProfileCatalog profiles = new(directory.Path);
        profiles.Add(
            new FacetProfileRegistration("a", "First", directory.Path, false, true, null, null)
        );
        profiles.Add(
            new FacetProfileRegistration("b", "Second", directory.Path, false, true, null, null)
        );
        profiles.Select("a");
        FacetProfileCatalog restored = new(directory.Path);
        Assert.AreEqual("a", restored.SelectedId);
        Assert.AreEqual(profiles.DeviceId, restored.DeviceId);
        Assert.HasCount(2, restored.Profiles);
        using var document = JsonDocument.Parse(
            File.ReadAllText(Path.Combine(directory.Path, "profiles.json"))
        );
        Assert.IsFalse(
            document.RootElement.GetRawText().Contains("token", StringComparison.OrdinalIgnoreCase)
        );
    }

    /// <summary>The complete envelope remains stable when an attempted command is retried.</summary>
    [TestMethod]
    public void RetryRetainsTimestampProfileAndCommandAcrossRestore()
    {
        using TemporaryDirectory directory = new();
        FacetMutationJournal journal = new(directory.Path);
        var first = journal.Prepare(
            "p",
            new { kind = "create", properties = new { title = "Original" } },
            "draft"
        );
        FacetMutationJournal restored = new(directory.Path);
        var retry = restored.Prepare(
            "p",
            new
            {
                kind = "create",
                properties = new { title = "A recomputed preview must not replace the envelope" },
            },
            "draft"
        );
        Assert.AreEqual(first, retry);
        FacetSchema.Bundled().Validate(retry.Document, "mutation");
        restored.Complete(retry, true);
        var after = new FacetMutationJournal(directory.Path);
        Assert.AreEqual(first.Id, after.UndoHead("p"));
        Assert.AreNotEqual(
            first.Id,
            after
                .Prepare(
                    "p",
                    new { kind = "create", properties = new { title = "Original" } },
                    "draft"
                )
                .Id
        );
    }

    /// <summary>Publishing a newer revision cannot replace a retained applied mutation.</summary>
    [TestMethod]
    public void RetryAfterPublishKeepsOriginalExpectedRevisions()
    {
        using TemporaryDirectory directory = new();
        FacetMutationJournal journal = new(directory.Path);
        var original = journal.Prepare(
            "p",
            new
            {
                kind = "batch",
                commands = new[]
                {
                    new
                    {
                        kind = "complete",
                        path = "a.md",
                        expectedRevision = "old",
                        completed = true,
                    },
                },
            }
        );
        var retry = new FacetMutationJournal(directory.Path).Prepare(
            "p",
            new
            {
                commands = new[]
                {
                    new
                    {
                        completed = true,
                        expectedRevision = "published",
                        path = "a.md",
                        kind = "complete",
                    },
                },
                kind = "batch",
            }
        );
        Assert.AreEqual(original, retry);
        StringAssert.Contains(retry.Document, "old", StringComparison.Ordinal);
        Assert.IsFalse(retry.Document.Contains("published", StringComparison.Ordinal));
    }

    /// <summary>A real rename failure never forgets the immutable identity in memory.</summary>
    [TestMethod]
    public void FailedJournalCleanupKeepsOriginalIdentity()
    {
        using TemporaryDirectory directory = new();
        FacetMutationJournal journal = new(directory.Path);
        var entry = journal.Prepare("p", new { kind = "delete", path = "a.md" });
        string path = Path.Combine(directory.Path, "mutation-envelopes.json");
        byte[] before = File.ReadAllBytes(path);
        File.Delete(path);
        Directory.CreateDirectory(path);
        _ = Assert.ThrowsExactly<IOException>(() => journal.Complete(entry, true));
        Assert.AreEqual(entry, journal.Prepare("p", new { kind = "delete", path = "a.md" }));
        Assert.AreEqual(0, journal.UndoDepth("p"));
        Directory.Delete(path);
        File.WriteAllBytes(path, before);
        Assert.AreEqual(
            entry,
            new FacetMutationJournal(directory.Path).Prepare(
                "p",
                new { kind = "delete", path = "a.md" }
            )
        );
    }
}
