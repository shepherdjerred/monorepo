using System.Security.Cryptography;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>Bounded immutable read images and lifetime-owned handle cleanup on real files.</summary>
[TestClass]
public sealed class FacetBoundedSnapshotTests
{
    private const string Owner = "original-vault";

    private static FileStream Open(string path) =>
        new(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);

    private static string Revision(byte[] bytes) =>
        Convert.ToHexStringLower(SHA256.HashData(bytes));

    /// <summary>Snapshots preserve captured bytes when the writable destination changes; exact EOF and ownership are enforced.</summary>
    [TestMethod]
    public void ChunksUseImmutableImageAndOwnerQualifiedLifetimeHandles()
    {
        using TemporaryDirectory directory = new();
        string source = Path.Combine(directory.Path, "source.bin");
        byte[] bytes = [1, 2, 3, 4];
        File.WriteAllBytes(source, bytes);
        using FacetBoundedSnapshots snapshots = new(Path.Combine(directory.Path, "images"), Owner);
        var snapshot = snapshots.Capture(Owner, () => Open(source))!;
        File.WriteAllBytes(source, [9, 9]);
        Assert.AreEqual(4UL, snapshot.Size);
        Assert.AreEqual(Revision(bytes), snapshot.Revision);
        CollectionAssert.AreEqual(new byte[] { 2, 3 }, snapshots.Read(Owner, snapshot.Id, 1, 2));
        Assert.AreEqual(0, snapshots.Read(Owner, snapshot.Id, 4, 0).Length);
        Assert.Throws<ArgumentOutOfRangeException>(() => snapshots.Read(Owner, snapshot.Id, 4, 1));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            snapshots.Read(Owner, snapshot.Id, 0, FacetBoundedStages.ChunkBytes + 1)
        );
        Assert.Throws<InvalidDataException>(() => snapshots.Read("other-vault", snapshot.Id, 0, 1));
        using FacetBoundedSnapshots otherEpoch = new(
            Path.Combine(directory.Path, "other-images"),
            Owner
        );
        Assert.Throws<InvalidDataException>(() => otherEpoch.Close(Owner, snapshot.Id));
        Assert.Throws<InvalidDataException>(() => snapshots.Close(Owner, "snapshot:unknown"));
        snapshots.Close(Owner, snapshot.Id);
        snapshots.Close(Owner, snapshot.Id);
        Assert.Throws<InvalidDataException>(() => snapshots.Read(Owner, snapshot.Id, 0, 0));
        CollectionAssert.AreEqual(new byte[] { 9, 9 }, File.ReadAllBytes(source));
    }

    /// <summary>Only four handles remain active; closing releases capacity without retaining a closed-ID memory backlog.</summary>
    [TestMethod]
    public void FourHandleBoundMissingFilesAndDisposalHaveExplicitOutcomes()
    {
        using TemporaryDirectory directory = new();
        string source = Path.Combine(directory.Path, "empty.bin");
        File.WriteAllBytes(source, []);
        string images = Path.Combine(directory.Path, "images");
        using FacetBoundedSnapshots snapshots = new(images, Owner);
        var handles = Enumerable
            .Range(0, 4)
            .Select(_ => snapshots.Capture(Owner, () => Open(source))!)
            .ToArray();
        Assert.IsNull(snapshots.Capture(Owner, () => null));
        Assert.Throws<IOException>(() => snapshots.Capture(Owner, () => Open(source)));
        snapshots.Close(Owner, handles[0].Id);
        var replacement = snapshots.Capture(Owner, () => Open(source))!;
        Assert.AreNotEqual(handles[0].Id, replacement.Id);
        Assert.AreEqual(4, Directory.GetFiles(images).Length);
        snapshots.Dispose();
        snapshots.Dispose();
        Assert.AreEqual(0, Directory.GetFiles(images).Length);
        Assert.Throws<ObjectDisposedException>(() => snapshots.Read(Owner, replacement.Id, 0, 0));
    }

    /// <summary>Ordinary concurrent descriptor changes get two attempts, then fail without publishing a torn image.</summary>
    [TestMethod]
    public void UnstableSourceFailsAfterTwoCopiesAndReleasesAllReadImages()
    {
        using TemporaryDirectory directory = new();
        string source = Path.Combine(directory.Path, "source.bin");
        File.WriteAllBytes(source, [1]);
        int copies = 0;
        string images = Path.Combine(directory.Path, "images");
        using FacetBoundedSnapshots snapshots = new(
            images,
            Owner,
            _ =>
            {
                copies++;
                File.WriteAllBytes(source, new byte[copies + 1]);
                File.SetLastWriteTimeUtc(
                    source,
                    new DateTime(2026, 10, 4, 0, 0, copies, DateTimeKind.Utc)
                );
            }
        );
        Assert.Throws<IOException>(() => snapshots.Capture(Owner, () => Open(source)));
        Assert.AreEqual(2, copies);
        Assert.AreEqual(0, Directory.GetFiles(images).Length);
    }

    /// <summary>A retry can capture a stable new image, while preserved predecessor size/hash mismatches never substitute data.</summary>
    [TestMethod]
    public void OneSourceChangeRetriesAndDisplacedMetadataRemainsStrict()
    {
        using TemporaryDirectory directory = new();
        string source = Path.Combine(directory.Path, "source.bin");
        File.WriteAllBytes(source, [1]);
        int copies = 0;
        string images = Path.Combine(directory.Path, "images");
        using FacetBoundedSnapshots snapshots = new(
            images,
            Owner,
            _ =>
            {
                if (++copies == 1)
                    File.WriteAllBytes(source, [2, 3]);
            }
        );
        var snapshot = snapshots.Capture(Owner, () => Open(source))!;
        Assert.AreEqual(2, copies);
        CollectionAssert.AreEqual(new byte[] { 2, 3 }, snapshots.Read(Owner, snapshot.Id, 0, 2));
        Assert.Throws<InvalidDataException>(() =>
            snapshots.Capture(Owner, () => Open(source), expectedSize: 1)
        );
        Assert.Throws<InvalidDataException>(() =>
            snapshots.Capture(Owner, () => Open(source), expectedRevision: Revision([9, 9]))
        );
        Assert.AreEqual(1, Directory.GetFiles(images).Length);
        snapshots.Close(Owner, snapshot.Id);
        Assert.IsTrue(File.Exists(source));
    }

    /// <summary>A same-sized substituted read image must be verified from its held descriptor before publication.</summary>
    [TestMethod]
    public void SubstitutedImageAndChangedHeldIdentityCannotAuthorizeSnapshotBytes()
    {
        using TemporaryDirectory directory = new();
        string source = Path.Combine(directory.Path, "source.bin");
        string images = Path.Combine(directory.Path, "images");
        File.WriteAllBytes(source, [1, 2]);
        using (
            FacetBoundedSnapshots substituted = new(
                images,
                Owner,
                _ => File.WriteAllBytes(Directory.GetFiles(images).Single(), [8, 9])
            )
        )
        {
            Assert.Throws<InvalidDataException>(() =>
                substituted.Capture(Owner, () => Open(source))
            );
            Assert.AreEqual(0, Directory.GetFiles(images).Length);
        }
        bool changed = false;
        using FacetBoundedSnapshots retained = new(
            images,
            Owner,
            identity: _ => changed ? "another-file-id" : "original-file-id"
        );
        var image = retained.Capture(Owner, () => Open(source))!;
        changed = true;
        Assert.Throws<InvalidDataException>(() => retained.Read(Owner, image.Id, 0, 1));
        retained.Close(Owner, image.Id);
        CollectionAssert.AreEqual(new byte[] { 1, 2 }, File.ReadAllBytes(source));
    }

    /// <summary>The actual Windows adapter uses volume/file-index identity; portable hosts fail explicitly.</summary>
    [TestMethod]
    public void NativeDescriptorIdentityIsPlatformQualified()
    {
        using TemporaryDirectory directory = new();
        string source = Path.Combine(directory.Path, "source.bin");
        File.WriteAllBytes(source, [1]);
        using FileStream stream = Open(source);
        Assert.AreEqual(24, FacetVaultFiles.BoundedIdentityRecordSize);
        if (OperatingSystem.IsWindows())
        {
            string identity = FacetVaultFiles.BoundedFileIdentity(stream);
            Assert.AreEqual(49, identity.Length);
            File.Move(source, Path.Combine(directory.Path, "moved.bin"));
            Assert.AreEqual(identity, FacetVaultFiles.BoundedFileIdentity(stream));
        }
        else
            Assert.Throws<PlatformNotSupportedException>(() =>
                FacetVaultFiles.BoundedFileIdentity(stream)
            );
    }
}
