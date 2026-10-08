using System.Globalization;
using System.Security.Cryptography;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>Physical atomic moves plus an injected identity seam; real Windows handle/OS acceptance remains separate.</summary>
[TestClass]
public sealed class FacetBoundedExchangeTests
{
    private const string Owner = "vault";
    private static readonly string NamespaceId = new('c', 64);
    private static readonly string Operation = "facet-write:" + new string('a', 64);

    /// <summary>Captured bytes and the first outcome survive mutable destination changes, cleanup and acknowledgement.</summary>
    [TestMethod]
    public void ReplacementReplaysOriginalOutcomeAfterCapturedAcknowledgement()
    {
        using TemporaryDirectory directory = new();
        string target = Path.Combine(directory.Path, "task.bin");
        File.WriteAllBytes(target, [1, 2]);
        string expected = Revision([1, 2]);
        var stages = Stages(directory.Path);
        var stage = Prepare(stages, expected, [3, 4]);
        var exchange = Exchanges(directory.Path, stages);
        var first = exchange.Exchange(Owner, Operation, "task.bin", expected, stage.Id);
        Assert.IsTrue(first.Applied);
        Assert.AreEqual(expected, first.Displaced!.Revision);
        CollectionAssert.AreEqual(new byte[] { 1, 2 }, File.ReadAllBytes(Captured(directory.Path)));
        File.WriteAllBytes(target, [9, 9]);
        File.Delete(Captured(directory.Path)); // Explicit disposition seam; never done by exchange/stage cleanup.
        stages.Discard(Owner, stage.Id);
        var replay = Exchanges(directory.Path, Stages(directory.Path))
            .Exchange(Owner, Operation, "task.bin", expected, stage.Id);
        Assert.AreEqual(first, replay);
        CollectionAssert.AreEqual(new byte[] { 9, 9 }, File.ReadAllBytes(target));
        Assert.Throws<InvalidDataException>(() =>
            exchange.Exchange(Owner, Operation, "different.bin", expected, stage.Id)
        );
    }

    /// <summary>An atomic replacement interrupted before outcome commit is recognized by its private captured predecessor.</summary>
    [TestMethod]
    public void CrashAfterReplacementRecoversIdenticalBytesWithoutRepeatingExchange()
    {
        using TemporaryDirectory directory = new();
        string target = Path.Combine(directory.Path, "task.bin");
        File.WriteAllBytes(target, [7]);
        string expected = Revision([7]);
        var stages = Stages(directory.Path);
        var stage = Prepare(stages, expected, [7]);
        var interrupted = Exchanges(
            directory.Path,
            stages,
            checkpoint =>
            {
                if (checkpoint == "exchanged")
                    throw new IOException("Interrupted after atomic replacement.");
            }
        );
        Assert.Throws<IOException>(() =>
            interrupted.Exchange(Owner, Operation, "task.bin", expected, stage.Id)
        );
        File.WriteAllBytes(target, [8]);
        var recovered = Exchanges(directory.Path, stages)
            .Exchange(Owner, Operation, "task.bin", expected, stage.Id);
        Assert.IsTrue(recovered.Applied);
        Assert.AreEqual(expected, recovered.Displaced!.Revision);
        CollectionAssert.AreEqual(new byte[] { 8 }, File.ReadAllBytes(target));
    }

    /// <summary>Create recovery requires the exact prepared identity; a missing slot cannot authorize a foreign destination.</summary>
    [TestMethod]
    public void CreateRecoveryRequiresIdentityAndRetainsAnUnprovableDecision()
    {
        using TemporaryDirectory directory = new();
        var stages = Stages(directory.Path);
        var stage = Prepare(stages, null, [1]);
        var interrupted = Exchanges(
            directory.Path,
            stages,
            checkpoint =>
            {
                if (checkpoint == "exchanged")
                    throw new IOException("Interrupted create.");
            },
            _ => "prepared-file-id"
        );
        Assert.Throws<IOException>(() =>
            interrupted.Exchange(Owner, Operation, "task.bin", null, stage.Id)
        );
        string target = Path.Combine(directory.Path, "task.bin");
        File.WriteAllBytes(target, [1]);
        var unproven = Exchanges(
            directory.Path,
            stages,
            identity: _ => "another-inode-with-identical-bytes"
        );
        Assert.Throws<InvalidDataException>(() =>
            unproven.Exchange(Owner, Operation, "task.bin", null, stage.Id)
        );
        Assert.AreEqual(
            1,
            Directory.GetFiles(Path.Combine(directory.Path, "operations"), "*.exchange.json").Length
        );
        var recovered = Exchanges(directory.Path, stages, identity: _ => "prepared-file-id")
            .Exchange(Owner, Operation, "task.bin", null, stage.Id);
        Assert.IsTrue(recovered.Applied);
        Assert.IsNull(recovered.Displaced);
    }

    /// <summary>A pre-exchange mismatch is durably false and never becomes a later opportunistic write.</summary>
    [TestMethod]
    public void RejectedFenceStaysRejectedAfterDestinationLaterMatches()
    {
        using TemporaryDirectory directory = new();
        string target = Path.Combine(directory.Path, "task.bin");
        File.WriteAllBytes(target, [2]);
        var stages = Stages(directory.Path);
        string expected = Revision([1]);
        var stage = Prepare(stages, expected, [3]);
        var first = Exchanges(directory.Path, stages)
            .Exchange(Owner, Operation, "task.bin", expected, stage.Id);
        Assert.IsFalse(first.Applied);
        File.WriteAllBytes(target, [1]);
        Assert.AreEqual(
            first,
            Exchanges(directory.Path, stages)
                .Exchange(Owner, Operation, "task.bin", expected, stage.Id)
        );
        CollectionAssert.AreEqual(new byte[] { 1 }, File.ReadAllBytes(target));
    }

    /// <summary>Tombstones capture exact predecessor bytes and replay without removing a later recreated file.</summary>
    [TestMethod]
    public void InterruptedDeleteRetainsPredecessorAndReplaysOriginalOutcome()
    {
        using TemporaryDirectory directory = new();
        string target = Path.Combine(directory.Path, "task.bin");
        File.WriteAllBytes(target, [5]);
        string expected = Revision([5]);
        var stages = Stages(directory.Path);
        var interrupted = Exchanges(
            directory.Path,
            stages,
            checkpoint =>
            {
                if (checkpoint == "exchanged")
                    throw new IOException("Interrupted delete.");
            }
        );
        Assert.Throws<IOException>(() =>
            interrupted.Exchange(Owner, Operation, "task.bin", expected, null)
        );
        Assert.IsFalse(File.Exists(target));
        File.WriteAllBytes(target, [6]);
        var recovered = Exchanges(directory.Path, stages)
            .Exchange(Owner, Operation, "task.bin", expected, null);
        Assert.IsTrue(recovered.Applied);
        Assert.AreEqual(expected, recovered.Displaced!.Revision);
        CollectionAssert.AreEqual(new byte[] { 6 }, File.ReadAllBytes(target));
    }

    /// <summary>The provider durability barrier must complete before an applied outcome can be published or acknowledged.</summary>
    [TestMethod]
    public void DurabilityFailureKeepsUnrecordedExchangeAndRetryFinishesBeforeReceipt()
    {
        using TemporaryDirectory directory = new();
        string target = Path.Combine(directory.Path, "task.bin");
        File.WriteAllBytes(target, [1]);
        var stages = Stages(directory.Path);
        string expected = Revision([1]);
        var stage = Prepare(stages, expected, [2]);
        bool refused = false;
        var failing = Exchanges(
            directory.Path,
            stages,
            durability: (path, captured) =>
            {
                if (path == target && captured is not null)
                {
                    refused = true;
                    Assert.IsTrue(File.Exists(captured));
                    throw new IOException("Injected provider persistence failure.");
                }
            }
        );
        Assert.Throws<IOException>(() =>
            failing.Exchange(Owner, Operation, "task.bin", expected, stage.Id)
        );
        Assert.IsTrue(refused);
        string manifest = Directory
            .GetFiles(Path.Combine(directory.Path, "operations"), "*.exchange.json")
            .Single();
        using (var value = System.Text.Json.JsonDocument.Parse(File.ReadAllText(manifest)))
            Assert.AreEqual(
                System.Text.Json.JsonValueKind.Null,
                value.RootElement.GetProperty("Outcome").ValueKind
            );
        bool persisted = false;
        int barriers = 0;
        var recovered = Exchanges(
                directory.Path,
                stages,
                checkpoint: phase =>
                {
                    if (phase == "outcome-recorded")
                    {
                        using var document = System.Text.Json.JsonDocument.Parse(
                            File.ReadAllText(manifest)
                        );
                        Assert.AreNotEqual(
                            System.Text.Json.JsonValueKind.Null,
                            document.RootElement.GetProperty("Outcome").ValueKind
                        );
                        Assert.IsTrue(persisted);
                    }
                },
                durability: (path, captured) =>
                {
                    if (path == target && captured is not null)
                    {
                        persisted = true;
                        barriers++;
                    }
                }
            )
            .Exchange(Owner, Operation, "task.bin", expected, stage.Id);
        Assert.IsTrue(recovered.Applied);
        Assert.IsTrue(persisted);
        Assert.AreEqual(1, barriers);
        Assert.AreEqual(expected, recovered.Displaced!.Revision);
        var replayed = Exchanges(
            directory.Path,
            stages,
            durability: (_, _) =>
                Assert.Fail(
                    "A recorded durable outcome cannot flush or reapply mutable destination state."
                )
        );
        Assert.AreEqual(
            recovered,
            replayed.Exchange(Owner, Operation, "task.bin", expected, stage.Id)
        );
        replayed.Acknowledge(recovered.Displaced.Id);
        Assert.AreEqual(
            recovered,
            replayed.Exchange(Owner, Operation, "task.bin", expected, stage.Id)
        );
    }

    /// <summary>Documented ReplaceFile error1177 can capture old bytes without installing even an identical replacement.</summary>
    [TestMethod]
    public void PartialReplacementRequiresPreparedSlotAndDestinationProof()
    {
        using TemporaryDirectory directory = new();
        string target = Path.Combine(directory.Path, "task.bin");
        File.WriteAllBytes(target, [1]);
        var stages = Stages(directory.Path);
        string expected = Revision([1]);
        var stage = Prepare(stages, expected, [1]);
        var partial = Exchanges(
            directory.Path,
            stages,
            identity: _ => "prepared-id",
            replace: (_, destination, backup) =>
            {
                File.Move(destination, backup);
                throw new IOException(
                    "Simulated ReplaceFile1177: predecessor moved, replacement not installed."
                );
            }
        );
        Assert.Throws<IOException>(() =>
            partial.Exchange(Owner, Operation, "task.bin", expected, stage.Id)
        );
        Assert.IsFalse(File.Exists(target));
        Assert.AreEqual(1, Directory.GetFiles(directory.Path, ".facet-slot-*").Length);
        string manifest = Directory
            .GetFiles(Path.Combine(directory.Path, "operations"), "*.exchange.json")
            .Single();
        using (var value = System.Text.Json.JsonDocument.Parse(File.ReadAllText(manifest)))
        {
            Assert.IsFalse(value.RootElement.GetProperty("Effected").GetBoolean());
            Assert.AreEqual(
                System.Text.Json.JsonValueKind.Null,
                value.RootElement.GetProperty("Outcome").ValueKind
            );
        }
        File.WriteAllBytes(target, [1]); // Equal bytes from a concurrent writer are not installation proof.
        Assert.Throws<InvalidDataException>(() =>
            Exchanges(directory.Path, stages, identity: _ => "prepared-id")
                .Exchange(Owner, Operation, "task.bin", expected, stage.Id)
        );
        Assert.IsTrue(File.Exists(Captured(directory.Path)));
        File.Delete(target);
        var recovered = Exchanges(directory.Path, stages, identity: _ => "prepared-id")
            .Exchange(Owner, Operation, "task.bin", expected, stage.Id);
        Assert.IsTrue(recovered.Applied);
        Assert.AreEqual(expected, recovered.Displaced!.Revision);
        Assert.IsTrue(File.Exists(target));
    }

    private static FacetBoundedStages Stages(string root) =>
        new(Path.Combine(root, "stages"), Owner, NamespaceId);

    private static FacetBoundedStages.Stage Prepare(
        FacetBoundedStages stages,
        string? expected,
        byte[] bytes
    )
    {
        var stage = stages.Begin(
            Owner,
            Operation,
            "task.bin",
            expected,
            (ulong)bytes.Length,
            Revision(bytes)
        );
        stages.Write(Owner, stage.Id, 0, bytes);
        return stages.Seal(Owner, stage.Id);
    }

    private static FacetBoundedExchange Exchanges(
        string root,
        FacetBoundedStages stages,
        Action<string>? checkpoint = null,
        Func<string, string>? identity = null,
        Action<string, string?>? durability = null,
        Action<string, string, string>? replace = null
    ) =>
        new(
            Path.Combine(root, "operations"),
            Owner,
            NamespaceId,
            stages,
            path =>
                path == "task.bin"
                    ? Path.Combine(root, path)
                    : throw new InvalidDataException("Unsupported test capability path."),
            identity
                ?? (
                    path =>
                        File.GetCreationTimeUtc(path).Ticks.ToString(CultureInfo.InvariantCulture)
                ),
            durability ?? ((_, _) => { }),
            checkpoint,
            replace
        );

    private static string Captured(string root) =>
        Directory.GetFiles(Path.Combine(root, "operations"), "*.captured.bytes").Single();

    private static string Revision(byte[] bytes) =>
        Convert.ToHexStringLower(SHA256.HashData(bytes));
}
