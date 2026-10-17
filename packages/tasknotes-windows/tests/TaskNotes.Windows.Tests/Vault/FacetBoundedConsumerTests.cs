using System.Security.Cryptography;
using TaskNotes.Windows.Host;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Tests;

/// <summary>Actual generated callback records and bounded admission over explicit portable component capabilities.</summary>
[TestClass]
public sealed class FacetBoundedConsumerTests
{
    private static readonly string[] ExpectedFiles = ["file.bin"];

    /// <summary>Callback conversion preserves original stage/backup ownership through exchange, retirement and exact replay.</summary>
    [TestMethod]
    public void CallbackRecordsPreserveOwnerAndRetainedVersion()
    {
        using TemporaryDirectory temporary = new();
        string root =
            OperatingSystem.IsMacOS()
            && temporary.Path.StartsWith("/var/", StringComparison.Ordinal)
                ? "/private" + temporary.Path
                : temporary.Path;
        string vault = Path.Combine(root, "vault");
        Directory.CreateDirectory(vault);
        File.WriteAllBytes(Path.Combine(vault, "file.bin"), [1, 2]);
        FacetVaultFiles files = new();
        files.Register("p", vault, true);
        using FacetBoundedCallbacks callbacks = new(
            files,
            Path.Combine(root, "metadata"),
            (profile, identity, directory) =>
                FacetPortableCapability.Create(files, profile, identity, directory)
        );
        FacetBoundedCallbacks abi = callbacks;
        Assert.Throws<Core.FacetHostException.Contract>(() => abi.ListFiles("p"));
        Assert.Throws<Core.FacetHostException.Contract>(() =>
            callbacks.BindRuntimeIdentity("invalid")
        );
        callbacks.BindRuntimeIdentity(new string('c', 64));
        callbacks.BindRuntimeIdentity(new string('c', 64));
        Assert.Throws<Core.FacetHostException.Contract>(() =>
            callbacks.BindRuntimeIdentity(new string('d', 64))
        );
        CollectionAssert.AreEqual(ExpectedFiles, abi.ListFiles("p"));
        var original = abi.OpenFileSnapshot("p", "file.bin")!;
        Assert.IsNull(abi.OpenFileSnapshot("p", "absent.bin"));
        string operation = "facet-write:" + new string('a', 64);
        string revision = Convert.ToHexStringLower(SHA256.HashData(new byte[] { 3, 4 }));
        var stage = abi.BeginReplacement(
            "p",
            operation,
            "file.bin",
            original.Revision,
            2,
            revision
        );
        Assert.AreEqual(operation, stage.OperationId);
        Assert.AreEqual("file.bin", stage.Path);
        Assert.Throws<Core.FacetHostException.Contract>(() =>
            abi.WriteReplacementChunk("p", stage.Id, 1, [3])
        );
        Assert.AreEqual(2UL, abi.WriteReplacementChunk("p", stage.Id, 0, [3, 4]).Written);
        Assert.IsTrue(abi.SealReplacement("p", stage.Id).Sealed);
        var outcome = abi.CompareExchangeStaged(
            "p",
            operation,
            stage.Path,
            original.Revision,
            stage.Id
        );
        Assert.IsTrue(outcome.Applied);
        Assert.AreEqual(outcome.Displaced, abi.DisplacedMetadata("p", null, 128).Single());
        var retained = abi.OpenDisplacedSnapshot("p", outcome.Displaced!.Id);
        CollectionAssert.AreEqual(
            new byte[] { 1, 2 },
            abi.ReadSnapshotChunk("p", retained.Id, 0, 2)
        );
        Assert.Throws<Core.FacetHostException.Contract>(() =>
            abi.ReadSnapshotChunk("p", original.Id, 1, 2)
        );
        Assert.Throws<Core.FacetHostException.Contract>(() => abi.DisplacedMetadata("p", null, 0));
        abi.CloseSnapshot("p", original.Id);
        abi.CloseSnapshot("p", retained.Id);
        abi.DiscardReplacement("p", stage.Id);
        abi.AcknowledgeDisplaced("p", outcome.Displaced.Id);
        abi.AcknowledgeDisplaced("p", outcome.Displaced.Id);
        Assert.IsEmpty(abi.DisplacedMetadata("p", null, 128));
        Assert.AreEqual(
            outcome,
            abi.CompareExchangeStaged("p", operation, stage.Path, original.Revision, stage.Id)
        );
        callbacks.DetachProfile("p");
        CollectionAssert.AreEqual(
            new byte[] { 3, 4 },
            File.ReadAllBytes(Path.Combine(vault, "file.bin"))
        );
        callbacks.Dispose();
        callbacks.Dispose();
        Assert.Throws<Core.FacetHostException.Contract>(() =>
            abi.OpenFileSnapshot("p", "file.bin")
        );
    }

    /// <summary>Busy reuses the captured request and respects a profile/account fence before the next attempt.</summary>
    [TestMethod]
    public async Task BusyReplayPreservesInputAndHonorsEarlyFence()
    {
        byte[] frame = [1, 2, 3];
        List<byte[]> seen = [];
        int attempts = 0;
        int waits = 0;
        string result = await FacetBusyReplay.RunAsync(
            () =>
            {
                seen.Add(frame);
                attempts++;
                return attempts switch
                {
                    1 => Task.FromException<string>(new Core.ObsidianBoundaryException.Busy()),
                    2 => Task.FromException<string>(new Core.FacetEngineException.Busy()),
                    _ => Task.FromResult("accepted"),
                };
            },
            () => true,
            TestContext.CancellationToken,
            _ =>
            {
                waits++;
                return Task.CompletedTask;
            }
        );
        Assert.AreEqual("accepted", result);
        Assert.AreEqual(3, attempts);
        Assert.AreEqual(2, waits);
        Assert.IsTrue(seen.All(value => ReferenceEquals(value, frame)));
        bool current = true;
        attempts = 0;
        await Assert.ThrowsExactlyAsync<OperationCanceledException>(() =>
            FacetBusyReplay.RunAsync(
                () =>
                {
                    attempts++;
                    return Task.FromException<bool>(new Core.ObsidianBoundaryException.Busy());
                },
                () => current,
                TestContext.CancellationToken,
                _ =>
                {
                    current = false;
                    return Task.CompletedTask;
                }
            )
        );
        Assert.AreEqual(1, attempts);
    }

    /// <summary>Permanent contract/validation failures escape without another wait or replay.</summary>
    [TestMethod]
    public async Task PermanentFailureNeverReplays()
    {
        foreach (
            Exception failure in new Exception[]
            {
                new Core.FacetEngineException.HostContract("private metadata"),
                new Core.FacetEngineException.Validation("invalid input"),
                new InvalidOperationException("internal contract"),
            }
        )
        {
            int attempts = 0;
            var actual = await Assert.ThrowsAsync<Exception>(() =>
                FacetBusyReplay.RunAsync(
                    () =>
                    {
                        attempts++;
                        return Task.FromException<bool>(failure);
                    },
                    () => true,
                    TestContext.CancellationToken,
                    _ => throw new InvalidOperationException("A permanent failure cannot wait.")
                )
            );
            Assert.AreSame(failure, actual);
            Assert.AreEqual(1, attempts);
        }
        using CancellationTokenSource cancellation = new();
        await cancellation.CancelAsync();
        int calls = 0;
        await Assert.ThrowsExactlyAsync<OperationCanceledException>(() =>
            FacetBusyReplay.RunAsync(
                () =>
                {
                    calls++;
                    return Task.FromResult(true);
                },
                () => true,
                cancellation.Token
            )
        );
        Assert.AreEqual(0, calls);
    }

    /// <summary>Framework cancellation.</summary>
    public required TestContext TestContext { get; set; }
}
