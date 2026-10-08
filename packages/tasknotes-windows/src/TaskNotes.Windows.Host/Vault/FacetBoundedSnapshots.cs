using System.Buffers;
using System.Security.Cryptography;
using System.Text;

namespace TaskNotes.Windows.Host;

/// <summary>At most four immutable read images; signed lifetime-qualified handles need no growing closed-ID set.</summary>
internal sealed class FacetBoundedSnapshots : IDisposable
{
    private const int CopyBytes = 65_536;
    private readonly string _directory;
    private readonly string _profile;
    private readonly byte[] _epochKey = RandomNumberGenerator.GetBytes(32);
    private readonly Dictionary<string, Image> _active = new(StringComparer.Ordinal);
    private readonly object _gate = new();
    private readonly Action<string>? _checkpoint;
    private readonly Func<FileStream, string>? _identity;
    private bool _disposed;

    internal FacetBoundedSnapshots(
        string directory,
        string profile,
        Action<string>? checkpoint = null,
        Func<FileStream, string>? identity = null
    )
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(profile);
        _directory = Path.GetFullPath(directory);
        _profile = profile;
        _checkpoint = checkpoint;
        _identity = identity;
        Directory.CreateDirectory(_directory);
        RejectLink(_directory);
    }

    internal Snapshot? Capture(
        string profile,
        Func<FileStream?> openSource,
        ulong? expectedSize = null,
        string? expectedRevision = null
    )
    {
        lock (_gate)
        {
            RequireOwner(profile);
            for (int attempt = 0; attempt < 2; attempt++)
            {
                using FileStream? source = openSource();
                if (source is null)
                    return null;
                if (_active.Count >= 4)
                    throw new IOException(
                        "Close an existing read snapshot before opening another."
                    );
                Stamp before = ReadStamp(source);
                string nonce = Guid.NewGuid().ToString("N");
                string id = "snapshot:" + nonce + ":" + Signature(nonce);
                string path = Path.Combine(_directory, nonce + ".read-image");
                bool retained = false;
                try
                {
                    ulong size = 0;
                    string revision;
                    using (
                        FileStream output = new(
                            path,
                            FileMode.CreateNew,
                            FileAccess.Write,
                            FileShare.None,
                            CopyBytes
                        )
                    )
                    using (
                        IncrementalHash digest = IncrementalHash.CreateHash(
                            HashAlgorithmName.SHA256
                        )
                    )
                    {
                        byte[] buffer = ArrayPool<byte>.Shared.Rent(CopyBytes);
                        try
                        {
                            int count;
                            while ((count = source.Read(buffer, 0, CopyBytes)) != 0)
                            {
                                output.Write(buffer.AsSpan(0, count));
                                digest.AppendData(buffer.AsSpan(0, count));
                                size = checked(size + (ulong)count);
                            }
                        }
                        finally
                        {
                            ArrayPool<byte>.Shared.Return(buffer, clearArray: true);
                        }
                        revision = Convert.ToHexStringLower(digest.GetHashAndReset());
                    }
                    _checkpoint?.Invoke("source-copied");
                    // One held descriptor retains its identity. Descriptor metadata
                    // detects ordinary writes; actual displaced bytes still fence CAS.
                    if (before != ReadStamp(source) || size != (ulong)before.Size)
                        continue;
                    if (
                        (expectedSize is { } requiredSize && requiredSize != size)
                        || (
                            expectedRevision is { } requiredRevision && requiredRevision != revision
                        )
                    )
                        throw new InvalidDataException(
                            "The retained predecessor does not match its durable metadata."
                        );
                    FileStream imageStream = new(
                        path,
                        FileMode.Open,
                        FileAccess.Read,
                        FileShare.Read,
                        CopyBytes
                    );
                    try
                    {
                        Stamp imageStamp = ReadStamp(imageStream);
                        if (
                            imageStamp.Size != checked((long)size)
                            || Convert.ToHexStringLower(SHA256.HashData(imageStream)) != revision
                            || ReadStamp(imageStream) != imageStamp
                        )
                            throw new InvalidDataException(
                                "The retained read descriptor differs from the exact captured image."
                            );
                        Snapshot metadata = new(id, size, revision);
                        _active.Add(id, new Image(path, imageStream, imageStamp, metadata));
                        retained = true;
                        return metadata;
                    }
                    catch
                    {
                        imageStream.Dispose();
                        throw;
                    }
                }
                finally
                {
                    if (!retained)
                        File.Delete(path);
                }
            }
            throw new IOException(
                "The vault file changed during both bounded snapshot attempts. Retry after the writer finishes."
            );
        }
    }

    internal byte[] Read(string profile, string id, ulong offset, uint length)
    {
        lock (_gate)
        {
            RequireOwner(profile);
            ValidateId(id);
            if (!_active.TryGetValue(id, out var image))
                throw new InvalidDataException("The read snapshot is closed or unknown.");
            if (
                length > FacetBoundedStages.ChunkBytes
                || offset > image.Metadata.Size
                || length > image.Metadata.Size - offset
            )
                throw new ArgumentOutOfRangeException(nameof(length));
            if (ReadStamp(image.Stream) != image.Stamp)
                throw new InvalidDataException("The immutable read image changed.");
            byte[] bytes = new byte[checked((int)length)];
            image.Stream.Position = checked((long)offset);
            image.Stream.ReadExactly(bytes);
            if (ReadStamp(image.Stream) != image.Stamp)
                throw new InvalidDataException(
                    "The immutable read image changed during its chunk read."
                );
            return bytes;
        }
    }

    internal void Close(string profile, string id)
    {
        lock (_gate)
        {
            RequireOwner(profile);
            ValidateId(id);
            if (_active.TryGetValue(id, out var image))
            {
                image.Stream.Dispose();
                File.Delete(image.Path);
                _active.Remove(id);
            }
            // A valid signature proves this owner/lifetime issued the handle.
            // Closed IDs need neither a memory set nor deletion of a predecessor.
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed)
                return;
            _disposed = true;
            Exception? failure = null;
            foreach (var image in _active.Values)
            {
                try
                {
                    image.Stream.Dispose();
                }
                catch (Exception error)
                {
                    failure ??= error;
                }
                try
                {
                    File.Delete(image.Path);
                }
                catch (Exception error)
                {
                    failure ??= error;
                }
            }
            _active.Clear();
            CryptographicOperations.ZeroMemory(_epochKey);
            if (failure is not null)
                System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure).Throw();
        }
        GC.SuppressFinalize(this);
    }

    private void RequireOwner(string profile)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (profile != _profile)
            throw new InvalidDataException("The read snapshot belongs to another vault.");
        RejectLink(_directory);
    }

    private string Signature(string nonce) =>
        Convert.ToHexStringLower(
            HMACSHA256.HashData(_epochKey, Encoding.UTF8.GetBytes(_profile + "\0" + nonce))
        );

    private void ValidateId(string id)
    {
        string[] parts = id.Split(':');
        if (
            parts.Length != 3
            || parts[0] != "snapshot"
            || parts[1].Length != 32
            || parts[2].Length != 64
            || parts
                .Skip(1)
                .Any(part => part.Any(c => !(c is >= '0' and <= '9' or >= 'a' and <= 'f')))
        )
            throw new InvalidDataException("The snapshot handle is invalid.");
        if (
            !CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(parts[2]),
                Convert.FromHexString(Signature(parts[1]))
            )
        )
            throw new InvalidDataException(
                "The snapshot was not issued by this owning engine lifetime."
            );
    }

    private static void RejectLink(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new UnauthorizedAccessException(
                "Read images cannot use links or reparse points."
            );
    }

    internal sealed record Snapshot(string Id, ulong Size, string Revision);

    private sealed record Image(string Path, FileStream Stream, Stamp Stamp, Snapshot Metadata);

    private Stamp ReadStamp(FileStream stream) =>
        new(
            stream.Length,
            File.GetCreationTimeUtc(stream.SafeFileHandle),
            File.GetLastWriteTimeUtc(stream.SafeFileHandle),
            _identity?.Invoke(stream) ?? string.Empty
        );

    private sealed record Stamp(long Size, DateTime Created, DateTime Modified, string Identity);
}
