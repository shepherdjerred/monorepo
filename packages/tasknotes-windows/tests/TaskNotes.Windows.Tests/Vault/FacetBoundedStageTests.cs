using System.Security.Cryptography;
using System.Text.Json.Nodes;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>Real durable staging without a full-file native payload or the forthcoming ABI.</summary>
[TestClass]
public sealed class FacetBoundedStageTests
{
    private const string Owner = "original-vault";
    private static readonly string EngineIdentity = new('c', 64);
    private static readonly string Operation = "facet-write:" + new string('a', 64);

    private static string Revision(byte[] bytes) =>
        Convert.ToHexStringLower(SHA256.HashData(bytes));

    /// <summary>Only unsealed prefix0 permits absence; a committed nonempty prefix survives reopen and refuses corrupt/missing bytes.</summary>
    [TestMethod]
    public void ReopenSealUsesDurablePrefixAndEmptyImagesRemainDistinct()
    {
        using TemporaryDirectory directory = new();
        FacetBoundedStages stages = new(directory.Path, Owner, EngineIdentity);
        var stage = stages.Begin(Owner, Operation, "file.bin", null, 2, Revision([1, 2]));
        string payload = Directory.GetFiles(directory.Path, "*.bytes").Single();
        File.Delete(payload);
        stages = new FacetBoundedStages(directory.Path, Owner, EngineIdentity);
        Assert.AreEqual(
            0UL,
            stages.Begin(Owner, Operation, "file.bin", null, 2, Revision([1, 2])).Written
        );
        stages.Write(Owner, stage.Id, 0, [1, 2]);
        stages = new FacetBoundedStages(directory.Path, Owner, EngineIdentity);
        Assert.AreEqual(
            2UL,
            stages.Begin(Owner, Operation, "file.bin", null, 2, Revision([1, 2])).Written
        );
        File.WriteAllBytes(payload, [9, 9]);
        Assert.Throws<InvalidDataException>(() => stages.Seal(Owner, stage.Id));
        File.Delete(payload);
        Assert.Throws<InvalidDataException>(() => stages.Seal(Owner, stage.Id));
        File.WriteAllBytes(payload, [1, 2]);
        Assert.IsTrue(stages.Seal(Owner, stage.Id).Sealed);
        stages = new FacetBoundedStages(directory.Path, Owner, EngineIdentity);
        stages.CopySealed(Owner, stage.Id, Path.Combine(directory.Path, "slot"));
        CollectionAssert.AreEqual(
            new byte[] { 1, 2 },
            File.ReadAllBytes(Path.Combine(directory.Path, "slot"))
        );

        using TemporaryDirectory empty = new();
        stages = new FacetBoundedStages(empty.Path, Owner, EngineIdentity);
        var zero = stages.Begin(Owner, Operation, "empty.bin", null, 0, Revision([]));
        string zeroBytes = Directory.GetFiles(empty.Path, "*.bytes").Single();
        File.Delete(zeroBytes);
        Assert.IsTrue(stages.Seal(Owner, zero.Id).Sealed);
        File.Delete(zeroBytes);
        Assert.Throws<InvalidDataException>(() => stages.Seal(Owner, zero.Id));
    }

    /// <summary>Durable IDs, sizes, paths and sealed prefixes are checked before recovery touches bytes.</summary>
    [TestMethod]
    public void CorruptManifestCannotChangeStageIntentOrAuthorizeAnExchange()
    {
        using TemporaryDirectory directory = new();
        FacetBoundedStages stages = new(directory.Path, Owner, EngineIdentity);
        var stage = stages.Begin(Owner, Operation, "file.bin", null, 2, Revision([1, 2]));
        stages.Write(Owner, stage.Id, 0, [1, 2]);
        stages.Seal(Owner, stage.Id);
        string manifest = Directory.GetFiles(directory.Path, "*.json").Single();
        string original = File.ReadAllText(manifest);
        foreach (
            var change in new (string Key, JsonNode Value)[]
            {
                ("OperationId", JsonValue.Create("facet-write:" + new string('b', 64))!),
                ("Profile", JsonValue.Create("other-vault")!),
                ("EngineIdentity", JsonValue.Create(new string('d', 64))!),
                ("Path", JsonValue.Create("../outside.bin")!),
                ("Size", JsonValue.Create(ulong.MaxValue)!),
                ("Written", JsonValue.Create(0)!),
            }
        )
        {
            JsonObject changed = JsonNode.Parse(original)!.AsObject();
            changed[change.Key] = change.Value;
            File.WriteAllText(manifest, changed.ToJsonString());
            Assert.Throws<InvalidDataException>(() =>
                stages.CopySealed(Owner, stage.Id, Path.Combine(directory.Path, "forbidden-slot"))
            );
            Assert.IsFalse(File.Exists(Path.Combine(directory.Path, "forbidden-slot")));
        }
        File.WriteAllText(manifest, original);
        FacetBoundedStages anotherEngine = new(directory.Path, Owner, new string('d', 64));
        Assert.Throws<InvalidDataException>(() => anotherEngine.Discard(Owner, stage.Id));
        Assert.AreEqual(1, Directory.GetFiles(directory.Path, "*.bytes").Length);
        stages.CopySealed(Owner, stage.Id, Path.Combine(directory.Path, "valid-slot"));
    }

    /// <summary>The copied bytes, not a stale earlier fingerprint, determine whether a slot is valid.</summary>
    [TestMethod]
    public void SourceMutationAtCopyBoundaryFailsInsteadOfAuthorizingAStaleReceipt()
    {
        using TemporaryDirectory directory = new();
        FacetBoundedStages stages = new(directory.Path, Owner, EngineIdentity);
        var stage = stages.Begin(Owner, Operation, "file.bin", null, 2, Revision([1, 2]));
        stages.Write(Owner, stage.Id, 0, [1, 2]);
        stages.Seal(Owner, stage.Id);
        string payload = Directory.GetFiles(directory.Path, "*.bytes").Single();
        stages = new FacetBoundedStages(
            directory.Path,
            Owner,
            EngineIdentity,
            checkpoint =>
            {
                if (checkpoint == "before-slot-copy")
                    File.WriteAllBytes(payload, [8, 8]);
            }
        );
        Assert.Throws<InvalidDataException>(() =>
            stages.CopySealed(Owner, stage.Id, Path.Combine(directory.Path, "unpublished-slot"))
        );
        File.WriteAllBytes(payload, [1]);
        stages = new FacetBoundedStages(directory.Path, Owner, EngineIdentity);
        Assert.Throws<InvalidDataException>(() =>
            stages.CopySealed(Owner, stage.Id, Path.Combine(directory.Path, "short-slot"))
        );
        Assert.IsFalse(File.Exists(Path.Combine(directory.Path, "short-slot")));
    }

    /// <summary>The supported 199 MiB payload crosses staging only in bounded chunks and a disk copy.</summary>
    [TestMethod]
    public void NearLimitStagingAndSlotCopyDoNotAllocateACompleteManagedFile()
    {
        using TemporaryDirectory directory = new();
        byte[] chunk = new byte[FacetBoundedStages.ChunkBytes];
        Array.Fill(chunk, (byte)37);
        const int count = 199;
        using IncrementalHash digest = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        for (int index = 0; index < count; index++)
            digest.AppendData(chunk);
        string revision = Convert.ToHexStringLower(digest.GetHashAndReset());
        FacetBoundedStages stages = new(directory.Path, Owner, EngineIdentity);
        long before = GC.GetAllocatedBytesForCurrentThread();
        var stage = stages.Begin(
            Owner,
            Operation,
            "legal-199-mib.bin",
            null,
            (ulong)count * FacetBoundedStages.ChunkBytes,
            revision
        );
        for (int index = 0; index < count; index++)
            stage = stages.Write(
                Owner,
                stage.Id,
                (ulong)index * FacetBoundedStages.ChunkBytes,
                chunk
            );
        stage = stages.Seal(Owner, stage.Id);
        string slot = Path.Combine(directory.Path, "large-exchange-slot");
        stages.CopySealed(Owner, stage.Id, slot);
        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        TestContext.WriteLine(
            $"Bounded stage 199 MiB managed current-thread allocation: {allocated} bytes."
        );
        Assert.IsTrue(
            allocated < 64L * 1024 * 1024,
            $"Managed staging allocated {allocated} bytes; a complete 199 MiB image must stay on disk."
        );
        Assert.AreEqual(208_666_624L, new FileInfo(slot).Length);
        using (FileStream stream = File.OpenRead(slot))
            Assert.AreEqual(revision, Convert.ToHexStringLower(SHA256.HashData(stream)));
        stages.Discard(Owner, stage.Id);
        Assert.IsTrue(File.Exists(slot));
    }

    /// <summary>Reopening retains the exact prefix and rejects changed owner, intent and chunk retries.</summary>
    [TestMethod]
    public void PrefixReopensAndOnlyExactBoundedRetriesSucceed()
    {
        using TemporaryDirectory directory = new();
        byte[] bytes = [1, 2, 3, 4];
        FacetBoundedStages stages = new(directory.Path, Owner, EngineIdentity);
        var stage = stages.Begin(
            Owner,
            Operation,
            "attachments/report.bin",
            null,
            4,
            Revision(bytes)
        );
        stage = stages.Write(Owner, stage.Id, 0, [1, 2]);
        Assert.AreEqual(2UL, stage.Written);
        stages = new FacetBoundedStages(directory.Path, Owner, EngineIdentity);
        Assert.AreEqual(stage, stages.Begin(Owner, Operation, stage.Path, null, 4, stage.Revision));
        Assert.AreEqual(stage, stages.Write(Owner, stage.Id, 0, [1, 2]));
        Assert.Throws<InvalidDataException>(() => stages.Write(Owner, stage.Id, 0, [9, 2]));
        Assert.Throws<InvalidDataException>(() => stages.Write(Owner, stage.Id, 1, [2, 3]));
        Assert.Throws<ArgumentOutOfRangeException>(() => stages.Write(Owner, stage.Id, 3, [4]));
        Assert.Throws<InvalidDataException>(() =>
            stages.Begin(Owner, Operation, "changed.bin", null, 4, stage.Revision)
        );
        Assert.Throws<InvalidDataException>(() => stages.Write("other-vault", stage.Id, 2, [3, 4]));
        stage = stages.Write(Owner, stage.Id, 2, [3, 4]);
        stage = stages.Seal(Owner, stage.Id);
        Assert.IsTrue(stage.Sealed);
        Assert.AreEqual(stage, stages.Seal(Owner, stage.Id));
        Assert.AreEqual(stage, stages.Write(Owner, stage.Id, 4, []));
        Assert.AreEqual(stage, stages.Write(Owner, stage.Id, 1, [2, 3]));
    }

    /// <summary>Bytes flushed before a failed prefix commit never advance durable progress on restart.</summary>
    [TestMethod]
    public void UncommittedTailIsTruncatedBeforeResuming()
    {
        using TemporaryDirectory directory = new();
        FacetBoundedStages stages = new(directory.Path, Owner, EngineIdentity);
        byte[] bytes = [1, 2, 3, 4];
        var stage = stages.Begin(Owner, Operation, "file.bin", null, 4, Revision(bytes));
        stage = stages.Write(Owner, stage.Id, 0, [1, 2]);
        string payload = Directory.GetFiles(directory.Path, "*.bytes").Single();
        using (FileStream stream = new(payload, FileMode.Append, FileAccess.Write))
        {
            stream.Write([99, 100]);
            stream.Flush(true);
        }
        stages = new FacetBoundedStages(directory.Path, Owner, EngineIdentity);
        var reopened = stages.Begin(Owner, Operation, stage.Path, null, stage.Size, stage.Revision);
        Assert.AreEqual(2UL, reopened.Written);
        Assert.AreEqual(2L, new FileInfo(payload).Length);
        stages.Write(Owner, stage.Id, 2, [3, 4]);
        Assert.IsTrue(stages.Seal(Owner, stage.Id).Sealed);
    }

    /// <summary>A durable manifest without its initial image can resume only a zero committed prefix.</summary>
    [TestMethod]
    public void InitialImageCreationResumesButCommittedLossFails()
    {
        using TemporaryDirectory directory = new();
        FacetBoundedStages stages = new(directory.Path, Owner, EngineIdentity);
        var stage = stages.Begin(Owner, Operation, "file.bin", null, 1, Revision([7]));
        string payload = Directory.GetFiles(directory.Path, "*.bytes").Single();
        File.Delete(payload);
        Assert.AreEqual(stage, stages.Begin(Owner, Operation, stage.Path, null, 1, stage.Revision));
        stages.Write(Owner, stage.Id, 0, [7]);
        File.Delete(payload);
        Assert.Throws<InvalidDataException>(() =>
            stages.Begin(Owner, Operation, stage.Path, null, 1, stage.Revision)
        );
    }

    /// <summary>Seal refuses incomplete bytes and a false supplied content hash without changing the receipt.</summary>
    [TestMethod]
    public void IncompleteOrWrongDigestCannotSeal()
    {
        using TemporaryDirectory directory = new();
        FacetBoundedStages stages = new(directory.Path, Owner, EngineIdentity);
        var stage = stages.Begin(Owner, Operation, "file.bin", null, 2, Revision([1, 2]));
        Assert.Throws<InvalidDataException>(() => stages.Seal(Owner, stage.Id));
        stages.Write(Owner, stage.Id, 0, [9, 9]);
        Assert.Throws<InvalidDataException>(() => stages.Seal(Owner, stage.Id));
        Assert.Throws<InvalidDataException>(() =>
            stages.CopySealed(Owner, stage.Id, Path.Combine(directory.Path, "slot"))
        );
    }

    /// <summary>The exchanged image is independent; modifying it cannot alter retained stage replay bytes.</summary>
    [TestMethod]
    public void ExchangeSlotIsSeparateAndDiscardRetainsImmutableIntent()
    {
        using TemporaryDirectory directory = new();
        FacetBoundedStages stages = new(directory.Path, Owner, EngineIdentity);
        byte[] bytes = [1, 2, 3];
        var stage = stages.Begin(Owner, Operation, "file.bin", Revision([9]), 3, Revision(bytes));
        stages.Write(Owner, stage.Id, 0, bytes);
        stage = stages.Seal(Owner, stage.Id);
        string slot = Path.Combine(directory.Path, "exchange-slot");
        stages.CopySealed(Owner, stage.Id, slot);
        File.WriteAllBytes(slot, [8, 8, 8]);
        Assert.AreEqual(stage, stages.Write(Owner, stage.Id, 0, bytes));
        stages.Discard(Owner, stage.Id);
        stages = new FacetBoundedStages(directory.Path, Owner, EngineIdentity);
        stages.Discard(Owner, stage.Id);
        Assert.AreEqual(0, Directory.GetFiles(directory.Path, "*.bytes").Length);
        Assert.AreEqual(1, Directory.GetFiles(directory.Path, "*.json").Length);
        Assert.IsTrue(
            stages
                .Begin(
                    Owner,
                    Operation,
                    stage.Path,
                    stage.ExpectedRevision,
                    stage.Size,
                    stage.Revision
                )
                .Retired
        );
        Assert.Throws<InvalidDataException>(() =>
            stages.Begin(Owner, Operation, stage.Path, null, stage.Size, stage.Revision)
        );
        Assert.Throws<InvalidDataException>(() => stages.Write(Owner, stage.Id, 0, bytes));
        Assert.Throws<InvalidDataException>(() => stages.Seal(Owner, stage.Id));
        Assert.Throws<InvalidDataException>(() =>
            stages.CopySealed(Owner, stage.Id, Path.Combine(directory.Path, "another-slot"))
        );
        Assert.Throws<InvalidDataException>(() => stages.Discard("other-vault", stage.Id));
    }

    /// <summary>A changed retained sealed image is a contract failure, never a substitute new upload.</summary>
    [TestMethod]
    public void TamperedSealedImageFailsAndOversizeChunksAreRejected()
    {
        using TemporaryDirectory directory = new();
        FacetBoundedStages stages = new(directory.Path, Owner, EngineIdentity);
        var stage = stages.Begin(Owner, Operation, "file.bin", null, 2, Revision([1, 2]));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            stages.Write(Owner, stage.Id, 0, new byte[FacetBoundedStages.ChunkBytes + 1])
        );
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            stages.Write(Owner, stage.Id, 0, [1, 2, 3])
        );
        stages.Write(Owner, stage.Id, 0, [1, 2]);
        stages.Seal(Owner, stage.Id);
        File.WriteAllBytes(Directory.GetFiles(directory.Path, "*.bytes").Single(), [1, 9]);
        Assert.Throws<InvalidDataException>(() =>
            stages.CopySealed(Owner, stage.Id, Path.Combine(directory.Path, "slot"))
        );
        Assert.Throws<InvalidDataException>(() => stages.Seal(Owner, stage.Id));
    }

    /// <summary>Zero bytes is a sealed file, with durable cleanup separate from deletion intent.</summary>
    [TestMethod]
    public void ZeroByteFileAndInvalidIdentitiesRemainDistinct()
    {
        using TemporaryDirectory directory = new();
        FacetBoundedStages stages = new(directory.Path, Owner, EngineIdentity);
        var stage = stages.Begin(Owner, Operation, "empty.bin", null, 0, Revision([]));
        stage = stages.Seal(Owner, stage.Id);
        string slot = Path.Combine(directory.Path, "zero-slot");
        stages.CopySealed(Owner, stage.Id, slot);
        Assert.AreEqual(0L, new FileInfo(slot).Length);
        Assert.Throws<InvalidDataException>(() =>
            stages.Begin(Owner, "../not-an-operation", stage.Path, null, 0, stage.Revision)
        );
        Assert.Throws<InvalidDataException>(() =>
            stages.Begin(Owner, Operation, stage.Path, null, 0, stage.Revision.ToUpperInvariant())
        );
        Assert.Throws<InvalidDataException>(() => stages.Discard(Owner, "../../outside"));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            stages.Begin(Owner, Operation, stage.Path, null, ulong.MaxValue, stage.Revision)
        );
    }

    /// <summary>Captures exact managed allocation evidence with the test report.</summary>
    public required TestContext TestContext { get; set; }
}
