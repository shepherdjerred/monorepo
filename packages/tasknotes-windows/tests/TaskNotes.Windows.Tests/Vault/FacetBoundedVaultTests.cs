using System.Globalization;
using System.Security.Cryptography;
using TaskNotes.Windows.Host;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Tests;

/// <summary>The complete proposed callback surface on physical files with explicit portable capability/identity seams.</summary>
[TestClass]
public sealed class FacetBoundedVaultTests
{
    private const string Owner = "vault";
    private static readonly string NamespaceId = new('c', 64);
    private static readonly string Operation = "facet-write:" + new string('a', 64);

    private static string Hash(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));

    /// <summary>Recorded predecessors remain readable after stage cleanup; acknowledgement is idempotent and replay retains the original result.</summary>
    [TestMethod]
    public void CapabilityLifecycleRetainsExactPredecessorAndImmutableOutcome()
    {
        using TemporaryDirectory directory = new();
        string vaultRoot = Path.Combine(directory.Path, "vault");
        Directory.CreateDirectory(vaultRoot);
        File.WriteAllBytes(Path.Combine(vaultRoot, "file.bin"), [1, 2]);
        using FacetBoundedVault vault = PortableCapability(directory.Path, vaultRoot);
        var snapshot = vault.OpenFileSnapshot(Owner, "file.bin")!;
        CollectionAssert.AreEqual(
            new byte[] { 1, 2 },
            vault.ReadSnapshotChunk(Owner, snapshot.Id, 0, 2)
        );
        vault.CloseSnapshot(Owner, snapshot.Id);
        vault.CloseSnapshot(Owner, snapshot.Id);
        Assert.IsNull(vault.OpenFileSnapshot(Owner, "nested/absent.bin"));
        var stage = vault.BeginReplacement(
            Owner,
            Operation,
            "file.bin",
            Hash([1, 2]),
            2,
            Hash([3, 4])
        );
        vault.WriteReplacementChunk(Owner, stage.Id, 0, [3, 4]);
        vault.SealReplacement(Owner, stage.Id);
        var applied = vault.CompareExchangeStaged(
            Owner,
            Operation,
            "file.bin",
            Hash([1, 2]),
            stage.Id
        );
        Assert.IsTrue(applied.Applied);
        var retained = vault.DisplacedMetadata(Owner, null, 1).Single();
        Assert.AreEqual(Hash([1, 2]), retained.Revision);
        string retainedBytes = Directory
            .GetFiles(
                Path.Combine(directory.Path, "private-metadata", "exchanges"),
                "*.captured.bytes"
            )
            .Single();
        File.Move(retainedBytes, retainedBytes + ".held");
        Assert.Throws<InvalidDataException>(() => vault.DisplacedMetadata(Owner, null, 128));
        File.Move(retainedBytes + ".held", retainedBytes);
        Assert.AreEqual(0, vault.DisplacedMetadata(Owner, retained.Id, 128).Length);
        var predecessor = vault.OpenDisplacedSnapshot(Owner, retained.Id);
        vault.DiscardReplacement(Owner, stage.Id);
        vault.DiscardReplacement(Owner, stage.Id);
        CollectionAssert.AreEqual(
            new byte[] { 1, 2 },
            vault.ReadSnapshotChunk(Owner, predecessor.Id, 0, 2)
        );
        vault.CloseSnapshot(Owner, predecessor.Id);
        Assert.AreEqual(1, vault.DisplacedMetadata(Owner, null, 128).Length);
        vault.AcknowledgeDisplaced(Owner, retained.Id);
        vault.AcknowledgeDisplaced(Owner, retained.Id);
        Assert.AreEqual(0, vault.DisplacedMetadata(Owner, null, 128).Length);
        Assert.Throws<InvalidDataException>(() => vault.OpenDisplacedSnapshot(Owner, retained.Id));
        File.WriteAllBytes(Path.Combine(vaultRoot, "file.bin"), [9]);
        Assert.AreEqual(
            applied,
            vault.CompareExchangeStaged(Owner, Operation, "file.bin", Hash([1, 2]), stage.Id)
        );
        Assert.Throws<InvalidDataException>(() =>
            vault.DisplacedMetadata("another-vault", null, 128)
        );
        vault.Dispose();
        Assert.Throws<ObjectDisposedException>(() => vault.OpenFileSnapshot(Owner, "file.bin"));
    }

    /// <summary>Production capability policy denies writable external folders before any stage bytes are authored.</summary>
    [TestMethod]
    public void ExternalReadonlyCapabilityRefusesStagesThroughActualOwnerFactory()
    {
        using TemporaryDirectory directory = new();
        // macOS /var is a link; use its real path and retain the production
        // capability guard's rejection of linked ancestors.
        string state =
            OperatingSystem.IsMacOS()
            && directory.Path.StartsWith("/var/", StringComparison.Ordinal)
                ? "/private" + directory.Path
                : directory.Path;
        string root = Path.Combine(state, "external");
        Directory.CreateDirectory(root);
        FacetVaultFiles files = new();
        files.Register(Owner, root);
        using FacetBoundedVault bounded = files.OpenBoundedCapability(
            Owner,
            NamespaceId,
            Path.Combine(state, "private-metadata")
        );
        Assert.Throws<Core.FacetHostException.PermissionDenied>(() =>
            bounded.BeginReplacement(Owner, Operation, "file.bin", null, 1, Hash([1]))
        );
        Assert.AreEqual(0, Directory.GetFileSystemEntries(root).Length);
        Assert.AreEqual(
            0,
            Directory.GetFiles(Path.Combine(state, "private-metadata", "stages")).Length
        );
    }

    /// <summary>The owner makes new nested directories through its checked creation capability, then applies a sealed zero-byte file distinctly from deletion.</summary>
    [TestMethod]
    public void NestedZeroLengthCreationAndAbandonedStageCleanupRemainBounded()
    {
        using TemporaryDirectory directory = new();
        string root = Path.Combine(directory.Path, "vault");
        Directory.CreateDirectory(root);
        using FacetBoundedVault vault = PortableCapability(directory.Path, root);
        var stage = vault.BeginReplacement(Owner, Operation, "nested/empty.bin", null, 0, Hash([]));
        vault.SealReplacement(Owner, stage.Id);
        Assert.IsTrue(
            vault
                .CompareExchangeStaged(Owner, Operation, "nested/empty.bin", null, stage.Id)
                .Applied
        );
        Assert.IsTrue(File.Exists(Path.Combine(root, "nested", "empty.bin")));
        Assert.AreEqual(0, new FileInfo(Path.Combine(root, "nested", "empty.bin")).Length);
        vault.DiscardReplacement(Owner, stage.Id);
        var abandoned = vault.BeginReplacement(
            Owner,
            "facet-write:" + new string('b', 64),
            "unused.bin",
            null,
            0,
            Hash([])
        );
        vault.DiscardReplacement(Owner, abandoned.Id);
        Assert.IsFalse(File.Exists(Path.Combine(root, "unused.bin")));
    }

    /// <summary>Legacy opaque IDs keep their spelling and share a stable cursor with new recorded outcomes.</summary>
    [TestMethod]
    public void LegacyAndNewMetadataPagesPreserveIdsAndBoundedSnapshots()
    {
        using TemporaryDirectory directory = new();
        string root = Path.Combine(directory.Path, "vault");
        string old = Path.Combine(directory.Path, "old-backups");
        Directory.CreateDirectory(root);
        Directory.CreateDirectory(old);
        string[] ids = [new('A', 32), new('2', 32), new('f', 32)];
        foreach (string id in ids)
            WriteLegacy(old, id, [1, 2]);
        FacetLegacyBackups legacy = Legacy(directory.Path, old, root);
        using FacetBoundedVault vault = PortableCapability(directory.Path, root, legacy);
        File.WriteAllBytes(Path.Combine(root, "file.bin"), [5]);
        var stage = vault.BeginReplacement(Owner, Operation, "file.bin", Hash([5]), 1, Hash([6]));
        vault.WriteReplacementChunk(Owner, stage.Id, 0, [6]);
        vault.SealReplacement(Owner, stage.Id);
        var outcome = vault.CompareExchangeStaged(
            Owner,
            Operation,
            "file.bin",
            Hash([5]),
            stage.Id
        );
        List<string> read = [];
        string? cursor = null;
        while (vault.DisplacedMetadata(Owner, cursor, 1) is { Length: > 0 } page)
        {
            read.Add(page.Single().Id);
            cursor = page.Single().Id;
        }
        CollectionAssert.AreEqual(
            ids.Append(outcome.Displaced!.Id).Order(StringComparer.Ordinal).ToArray(),
            read.ToArray()
        );
        var captured = vault.OpenDisplacedSnapshot(Owner, ids[0]);
        CollectionAssert.AreEqual(
            new byte[] { 1, 2 },
            vault.ReadSnapshotChunk(Owner, captured.Id, 0, 2)
        );
        vault.CloseSnapshot(Owner, captured.Id);
        vault.AcknowledgeDisplaced(Owner, ids[0]);
        vault.AcknowledgeDisplaced(Owner, ids[0]);
        Assert.AreEqual(3, vault.DisplacedMetadata(Owner, null, 128).Length);
        Assert.Throws<InvalidDataException>(() => vault.OpenDisplacedSnapshot(Owner, ids[0]));
    }

    /// <summary>Committed ACK survives interruptions on either side of unlink; altered owner/bytes never authorize cleanup.</summary>
    [TestMethod]
    public void LegacyAcknowledgementRecoversEveryCleanupCheckpointAndRejectsTampering()
    {
        foreach (string fault in new[] { "acknowledged", "bytes-removed", "metadata-removed" })
        {
            using TemporaryDirectory directory = new();
            string old = Path.Combine(directory.Path, "old");
            Directory.CreateDirectory(old);
            string id = new('b', 32);
            WriteLegacy(old, id, [1, 2]);
            FacetLegacyBackups first = Legacy(
                directory.Path,
                old,
                directory.Path,
                point =>
                {
                    if (point == fault)
                        throw new IOException("Injected cleanup interruption");
                }
            );
            Assert.Throws<IOException>(() => first.Acknowledge(id));
            FacetLegacyBackups reopened = Legacy(directory.Path, old, directory.Path);
            reopened.Acknowledge(id);
            reopened.Acknowledge(id);
            Assert.AreEqual(0, reopened.Metadata(null, 128).Length);
            Assert.IsFalse(File.Exists(Path.Combine(old, id + ".bytes")));
            Assert.IsFalse(File.Exists(Path.Combine(old, id + ".json")));
            string receiptPath = Directory.GetFiles(Path.Combine(directory.Path, "acks")).Single();
            string receipt = File.ReadAllText(receiptPath);
            File.WriteAllText(
                receiptPath,
                receipt.Replace(NamespaceId, new string('d', 64), StringComparison.Ordinal)
            );
            Assert.Throws<InvalidDataException>(() => reopened.Acknowledge(id));
            foreach (string field in new[] { "Profile", "EngineIdentity", "Metadata" })
            {
                var document = System.Text.Json.Nodes.JsonNode.Parse(receipt)!.AsObject();
                document[field] = null;
                File.WriteAllText(receiptPath, document.ToJsonString());
                Assert.Throws<InvalidDataException>(() => reopened.Acknowledge(id));
            }
            foreach (string field in new[] { "Path", "Revision" })
            {
                var document = System.Text.Json.Nodes.JsonNode.Parse(receipt)!.AsObject();
                document["Metadata"]!.AsObject()[field] = null;
                File.WriteAllText(receiptPath, document.ToJsonString());
                Assert.Throws<InvalidDataException>(() => reopened.Acknowledge(id));
            }
        }
        using TemporaryDirectory changed = new();
        string backups = Path.Combine(changed.Path, "old");
        Directory.CreateDirectory(backups);
        string changedId = new('c', 32);
        WriteLegacy(backups, changedId, [1]);
        var pending = Legacy(
            changed.Path,
            backups,
            changed.Path,
            point =>
            {
                if (point == "acknowledged")
                    throw new IOException("Pause");
            }
        );
        Assert.Throws<IOException>(() => pending.Acknowledge(changedId));
        File.WriteAllBytes(Path.Combine(backups, changedId + ".bytes"), [9]);
        var resumed = Legacy(changed.Path, backups, changed.Path);
        Assert.Throws<InvalidDataException>(() => resumed.Acknowledge(changedId));
        CollectionAssert.AreEqual(
            new byte[] { 9 },
            File.ReadAllBytes(Path.Combine(backups, changedId + ".bytes"))
        );
    }

    private static void WriteLegacy(string directory, string id, byte[] bytes)
    {
        File.WriteAllBytes(Path.Combine(directory, id + ".bytes"), bytes);
        File.WriteAllText(
            Path.Combine(directory, id + ".json"),
            System.Text.Json.JsonSerializer.Serialize(
                new
                {
                    Path = "file.bin",
                    Size = bytes.Length,
                    Revision = Hash(bytes),
                }
            )
        );
    }

    /// <summary>Unsealed captured files are sealed by bounded hashing; missing and corrupt records remain available for review.</summary>
    [TestMethod]
    public void LegacyMetadataValidationRetainsMissingCorruptAndReadonlyRecords()
    {
        using TemporaryDirectory directory = new();
        string old = Path.Combine(directory.Path, "old");
        string id = new('1', 32);
        FacetLegacyBackups legacy = Legacy(directory.Path, old, directory.Path);
        Assert.AreEqual(0, legacy.Metadata(null, 128).Length);
        Assert.Throws<ArgumentOutOfRangeException>(() => legacy.Metadata(null, 0));
        Assert.Throws<InvalidDataException>(() => legacy.Source("unknown"));
        Directory.CreateDirectory(old);
        string metadata = Path.Combine(old, id + ".json");
        File.WriteAllText(metadata, "{\"Path\":\"file.bin\"}");
        Assert.Throws<Core.FacetHostException.Unavailable>(() => legacy.Metadata(null, 128));
        Assert.AreEqual("{\"Path\":\"file.bin\"}", File.ReadAllText(metadata));
        File.WriteAllBytes(Path.Combine(old, id + ".bytes"), [1, 2]);
        FacetLegacyBackups denied = new(
            old,
            Path.Combine(directory.Path, "acks"),
            Owner,
            NamespaceId,
            path => File.Exists(path) ? File.OpenRead(path) : null,
            path => Path.Combine(directory.Path, path),
            requireWritable: () => throw new UnauthorizedAccessException()
        );
        Assert.Throws<UnauthorizedAccessException>(() => denied.Source(id));
        Assert.AreEqual("{\"Path\":\"file.bin\"}", File.ReadAllText(metadata));
        Assert.AreEqual(Hash([1, 2]), legacy.Source(id).Metadata.Revision);
        File.WriteAllText(
            metadata,
            "{\"Path\":\"file.bin\",\"Size\":\"2\",\"Revision\":\"" + Hash([1, 2]) + "\"}"
        );
        Assert.Throws<System.Text.Json.JsonException>(() => legacy.Source(id));
        WriteLegacy(old, id, [1, 2]);
        File.WriteAllBytes(Path.Combine(old, id + ".bytes"), [9]);
        Assert.Throws<InvalidDataException>(() => legacy.Source(id));
        File.WriteAllText(metadata, new string(' ', 65_537));
        Assert.Throws<InvalidDataException>(() => legacy.Source(id));
        File.WriteAllText(metadata, "null");
        Assert.Throws<InvalidDataException>(() => legacy.Source(id));
        File.WriteAllText(metadata, "{\"Path\":null}");
        Assert.Throws<InvalidDataException>(() => legacy.Source(id));
        Assert.Throws<InvalidDataException>(() =>
            new FacetLegacyBackups(
                old,
                Path.Combine(directory.Path, "invalid"),
                Owner,
                "invalid",
                File.OpenRead,
                path => path
            )
        );
    }

    /// <summary>Metadata that grows or truncates after opening cannot escape the captured descriptor bound.</summary>
    [TestMethod]
    public void LegacyMetadataGrowthAndTruncationPreserveBackupBytes()
    {
        foreach (bool grow in new[] { true, false })
        {
            using TemporaryDirectory directory = new();
            string old = Path.Combine(directory.Path, "old");
            Directory.CreateDirectory(old);
            string id = new('a', 32);
            WriteLegacy(old, id, [1]);
            string metadata = Path.Combine(old, id + ".json");
            long originalSize = new FileInfo(metadata).Length;
            bool once = true;
            var legacy = Legacy(
                directory.Path,
                old,
                directory.Path,
                point =>
                {
                    if (point == "metadata-opened" && once)
                    {
                        once = false;
                        if (grow)
                            File.AppendAllText(metadata, new string(' ', 65_536));
                        else
                            File.WriteAllText(metadata, "");
                    }
                }
            );
            if (grow)
                Assert.Throws<InvalidDataException>(() => legacy.Source(id));
            else
                Assert.Throws<EndOfStreamException>(() => legacy.Source(id));
            Assert.AreEqual(grow ? originalSize + 65_536 : 0, new FileInfo(metadata).Length);
            CollectionAssert.AreEqual(
                new byte[] { 1 },
                File.ReadAllBytes(Path.Combine(old, id + ".bytes"))
            );
            Assert.AreEqual(0, Directory.GetFiles(Path.Combine(directory.Path, "acks")).Length);
        }
    }

    private static FacetLegacyBackups Legacy(
        string state,
        string old,
        string root,
        Action<string>? checkpoint = null
    ) =>
        new(
            old,
            Path.Combine(state, "acks"),
            Owner,
            NamespaceId,
            path =>
                File.Exists(path)
                    ? new FileStream(
                        path,
                        FileMode.Open,
                        FileAccess.Read,
                        FileShare.ReadWrite | FileShare.Delete
                    )
                    : null,
            path => Path.Combine(root, path),
            checkpoint
        );

    private static FacetBoundedVault PortableCapability(
        string state,
        string root,
        FacetLegacyBackups? legacy = null
    ) =>
        new(
            Path.Combine(state, "private-metadata"),
            Owner,
            NamespaceId,
            root,
            path =>
            {
                if (
                    Path.IsPathRooted(path)
                    || path.Split('/').Any(value => value is "" or "." or "..")
                )
                    throw new InvalidDataException("Invalid test capability path.");
                return Path.Combine(root, path);
            },
            _ => new PortablePins(),
            path =>
            {
                try
                {
                    return new FileStream(
                        path,
                        FileMode.Open,
                        FileAccess.Read,
                        FileShare.ReadWrite | FileShare.Delete
                    );
                }
                catch (FileNotFoundException)
                {
                    return null;
                }
            },
            () => { },
            path => Directory.CreateDirectory(Path.GetDirectoryName(Path.Combine(root, path))!),
            stream =>
                File.GetCreationTimeUtc(stream.SafeFileHandle)
                    .Ticks.ToString(CultureInfo.InvariantCulture),
            (_, _) => { },
            legacy
        );

    private sealed class PortablePins : IDisposable
    {
        public void Dispose() { }
    }
}
