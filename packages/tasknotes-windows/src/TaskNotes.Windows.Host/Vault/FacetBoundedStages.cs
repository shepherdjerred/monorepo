using System.Buffers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TaskNotes.Windows.Host;

/// <summary>ABI-independent durable staging; the coordinated callback adapter supplies capability and disposition checks.</summary>
internal sealed class FacetBoundedStages
{
    internal const int ChunkBytes = 1_048_576;
    private const int CopyBytes = 65_536;
    private readonly string _directory;
    private readonly string _profile;
    private readonly string _engineIdentity;
    private readonly Action<string>? _checkpoint;
    private readonly object _gate = new();
    private static readonly JsonSerializerOptions MetadataOptions = new()
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    };

    internal FacetBoundedStages(
        string directory,
        string profile,
        string engineIdentity,
        Action<string>? checkpoint = null
    )
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(profile);
        RequireHash(engineIdentity);
        _profile = profile;
        _engineIdentity = engineIdentity;
        _checkpoint = checkpoint;
        _directory = Path.GetFullPath(directory);
        Directory.CreateDirectory(_directory);
        RejectLink(_directory);
    }

    internal Stage Begin(
        string profile,
        string operationId,
        string path,
        string? expectedRevision,
        ulong size,
        string revision
    )
    {
        lock (_gate)
        {
            RequireOwner(profile);
            RequireOperation(operationId);
            RequireHash(revision);
            if (expectedRevision is not null)
                RequireHash(expectedRevision);
            RequirePath(path);
            ArgumentOutOfRangeException.ThrowIfGreaterThan(size, (ulong)long.MaxValue);
            string id = StageId(_engineIdentity, profile, operationId);
            string manifest = Manifest(id);
            if (File.Exists(manifest))
            {
                Stage existing = Read(id);
                if (
                    existing.OperationId != operationId
                    || existing.Path != path
                    || existing.ExpectedRevision != expectedRevision
                    || existing.Size != size
                    || existing.Revision != revision
                )
                    throw new InvalidDataException(
                        "A durable stage identity cannot change its write intent."
                    );
                Recover(existing);
                return existing;
            }
            Stage stage = new(
                1,
                id,
                profile,
                _engineIdentity,
                operationId,
                path,
                expectedRevision,
                size,
                revision,
                0,
                false,
                false
            );
            // The immutable intent is durable before any bytes are created.
            FacetDurableJson.Write(manifest, stage);
            Recover(stage);
            return stage;
        }
    }

    internal Stage Write(string profile, string id, ulong offset, byte[] bytes)
    {
        lock (_gate)
        {
            RequireOwner(profile);
            ArgumentNullException.ThrowIfNull(bytes);
            if (bytes.Length > ChunkBytes)
                throw new ArgumentOutOfRangeException(nameof(bytes));
            Stage stage = Read(id);
            if (stage.Retired)
                throw new InvalidDataException("A retired stage cannot accept payload bytes.");
            Recover(stage);
            if (
                offset > stage.Written
                || offset > stage.Size
                || (ulong)bytes.Length > stage.Size - offset
            )
                throw new ArgumentOutOfRangeException(nameof(offset));
            if (offset < stage.Written || stage.Sealed)
            {
                if ((ulong)bytes.Length > stage.Written - offset)
                    throw new InvalidDataException(
                        "A retried chunk cannot overlap the committed prefix boundary."
                    );
                VerifyChunk(Payload(id), offset, bytes);
                return stage;
            }
            using (FileStream stream = Open(Payload(id), FileMode.Open, FileAccess.Write))
            {
                stream.Position = checked((long)offset);
                stream.Write(bytes);
                stream.Flush(true);
            }
            Stage written = stage with { Written = checked(offset + (ulong)bytes.Length) };
            // Recovery truncates bytes whose prefix manifest never committed.
            FacetDurableJson.Write(Manifest(id), written);
            return written;
        }
    }

    internal Stage Seal(string profile, string id)
    {
        lock (_gate)
        {
            RequireOwner(profile);
            Stage stage = Read(id);
            if (stage.Retired)
                throw new InvalidDataException("A retired stage cannot be sealed.");
            Recover(stage);
            if (stage.Written != stage.Size || Fingerprint(Payload(id)) != stage.Revision)
                throw new InvalidDataException(
                    "The prepared payload does not match its exact size and SHA256."
                );
            if (stage.Sealed)
                return stage;
            // Every nonempty written prefix was flushed before its manifest
            // committed. Seal changes metadata only; empty images have no such
            // data-write barrier and must persist their file before sealing.
            if (stage.Size == 0)
                using (FileStream stream = Open(Payload(id), FileMode.Open, FileAccess.Write))
                    stream.Flush(true);
            Stage sealedStage = stage with { Sealed = true };
            FacetDurableJson.Write(Manifest(id), sealedStage);
            return sealedStage;
        }
    }

    internal void CopySealed(string profile, string id, string exchangeSlot)
    {
        lock (_gate)
        {
            RequireOwner(profile);
            Stage stage = Read(id);
            if (!stage.Sealed || stage.Retired)
                throw new InvalidDataException(
                    "Exchange requires the retained immutable sealed payload."
                );
            _checkpoint?.Invoke("before-slot-copy");
            using FileStream source = Open(Payload(id), FileMode.Open, FileAccess.Read);
            if ((ulong)source.Length != stage.Size)
                throw new InvalidDataException("The sealed source size changed before exchange.");
            using FileStream destination = Open(
                exchangeSlot,
                FileMode.CreateNew,
                FileAccess.ReadWrite
            );
            using IncrementalHash digest = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            byte[] buffer = ArrayPool<byte>.Shared.Rent(CopyBytes);
            ulong copied = 0;
            try
            {
                int count;
                while ((count = source.Read(buffer, 0, CopyBytes)) != 0)
                {
                    if ((ulong)count > stage.Size - copied)
                        throw new InvalidDataException(
                            "The sealed source grew during exchange preparation."
                        );
                    destination.Write(buffer.AsSpan(0, count));
                    digest.AppendData(buffer.AsSpan(0, count));
                    copied += (ulong)count;
                }
            }
            finally
            {
                ArrayPool<byte>.Shared.Return(buffer, clearArray: true);
            }
            if (
                copied != stage.Size
                || (ulong)source.Length != stage.Size
                || Convert.ToHexStringLower(digest.GetHashAndReset()) != stage.Revision
            )
                throw new InvalidDataException(
                    "The bytes copied to the exchange slot violate the sealed receipt."
                );
            destination.Flush(true);
            _checkpoint?.Invoke("slot-copied");
            destination.Position = 0;
            if (
                (ulong)destination.Length != stage.Size
                || Convert.ToHexStringLower(SHA256.HashData(destination)) != stage.Revision
            )
                throw new InvalidDataException(
                    "The durable exchange slot violates the sealed receipt."
                );
            // The exchanged slot is a distinct file, never a writable hard link
            // or a move of the sole sealed source image.
        }
    }

    internal void Discard(string profile, string id)
    {
        lock (_gate)
        {
            RequireOwner(profile);
            Stage stage = Read(id);
            if (!stage.Retired)
            {
                stage = stage with { Retired = true };
                FacetDurableJson.Write(Manifest(id), stage);
            }
            File.Delete(Payload(id));
            // Keep the compact intent receipt for lazy exact cleanup/restart
            // replay. This never acknowledges a displaced predecessor.
        }
    }

    internal Stage RequireSealed(string profile, string id)
    {
        lock (_gate)
        {
            RequireOwner(profile);
            Stage stage = Read(id);
            if (!stage.Sealed || stage.Retired)
                throw new InvalidDataException("Exchange requires an active sealed stage.");
            Recover(stage);
            return stage;
        }
    }

    internal Stage Receipt(string profile, string id)
    {
        lock (_gate)
        {
            RequireOwner(profile);
            return Read(id);
        }
    }

    private Stage Read(string id)
    {
        string path = Manifest(id);
        using FileStream stream = Open(path, FileMode.Open, FileAccess.Read);
        if (stream.Length > 65_536)
            throw new InvalidDataException(
                "The private stage manifest exceeds its metadata limit."
            );
        Stage stage =
            JsonSerializer.Deserialize<Stage>(stream, MetadataOptions)
            ?? throw new InvalidDataException("The durable stage manifest is empty.");
        if (
            stage.SchemaVersion != 1
            || stage.Id != id
            || stage.Profile != _profile
            || stage.EngineIdentity != _engineIdentity
            || stage.Size > long.MaxValue
            || stage.Written > stage.Size
            || (stage.Sealed && stage.Written != stage.Size)
        )
            throw new InvalidDataException(
                "The durable stage manifest has an invalid owner or prefix."
            );
        RequireOperation(stage.OperationId);
        RequirePath(stage.Path);
        if (StageId(stage.EngineIdentity, stage.Profile, stage.OperationId) != id)
            throw new InvalidDataException(
                "The stage handle does not identify its stored write intent."
            );
        RequireHash(stage.Revision);
        if (stage.ExpectedRevision is not null)
            RequireHash(stage.ExpectedRevision);
        return stage;
    }

    private void Recover(Stage stage)
    {
        string path = Payload(stage.Id);
        if (stage.Retired)
        {
            File.Delete(path);
            return;
        }
        if (!File.Exists(path))
        {
            if (stage.Written != 0 || stage.Sealed)
                throw new InvalidDataException("The durable stage is missing committed bytes.");
            using FileStream created = Open(path, FileMode.CreateNew, FileAccess.Write);
            // A preparing prefix0 explicitly permits this empty file to be
            // absent after interruption. Write/empty Seal establish persistence
            // before any nonzero prefix or sealed manifest can commit.
        }
        using FileStream stream = Open(path, FileMode.Open, FileAccess.ReadWrite);
        if (
            (ulong)stream.Length < stage.Written
            || (stage.Sealed && (ulong)stream.Length != stage.Size)
        )
            throw new InvalidDataException(
                "The durable stage lost or changed its committed payload."
            );
        if ((ulong)stream.Length > stage.Written)
        {
            stream.SetLength(checked((long)stage.Written));
            stream.Flush(true);
        }
    }

    private string Manifest(string id) => Path.Combine(_directory, Key(id) + ".json");

    private string Payload(string id) => Path.Combine(_directory, Key(id) + ".bytes");

    private static string Key(string id)
    {
        if (!id.StartsWith("facet-stage:", StringComparison.Ordinal) || id.Length != 76)
            throw new InvalidDataException("The stage handle is unknown.");
        RequireHash(id[12..]);
        return Hash(Encoding.UTF8.GetBytes(id));
    }

    private void RequireOwner(string profile)
    {
        if (profile != _profile)
            throw new InvalidDataException("The stage belongs to another vault.");
        RejectLink(_directory);
    }

    private static void RequireOperation(string value)
    {
        if (!value.StartsWith("facet-write:", StringComparison.Ordinal) || value.Length != 76)
            throw new InvalidDataException("The file-write identity is invalid.");
        RequireHash(value[12..]);
    }

    private static void RequireHash(string hash)
    {
        if (hash.Length != 64 || hash.Any(c => !(c is >= '0' and <= '9' or >= 'a' and <= 'f')))
            throw new InvalidDataException("An exact lowercase SHA256 is required.");
    }

    private static string Hash(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));

    private static string StageId(string engineIdentity, string profile, string operationId) =>
        "facet-stage:"
        + Hash(Encoding.UTF8.GetBytes(engineIdentity + "\0" + profile + "\0" + operationId));

    private static void RequirePath(string path)
    {
        if (
            string.IsNullOrWhiteSpace(path)
            || Path.IsPathRooted(path)
            || path.Contains('\\', StringComparison.Ordinal)
            || path.Any(char.IsControl)
            || path.Split('/').Any(part => part is "" or "." or "..")
        )
            throw new InvalidDataException("The stage requires an exact vault-relative path.");
    }

    private static string Fingerprint(string path)
    {
        using FileStream stream = Open(path, FileMode.Open, FileAccess.Read);
        return Convert.ToHexStringLower(SHA256.HashData(stream));
    }

    private static void VerifyChunk(string path, ulong offset, byte[] bytes)
    {
        using FileStream stream = Open(path, FileMode.Open, FileAccess.Read);
        stream.Position = checked((long)offset);
        byte[] buffer = ArrayPool<byte>.Shared.Rent(CopyBytes);
        try
        {
            for (int position = 0; position < bytes.Length; )
            {
                int count = Math.Min(CopyBytes, bytes.Length - position);
                stream.ReadExactly(buffer.AsSpan(0, count));
                if (!buffer.AsSpan(0, count).SequenceEqual(bytes.AsSpan(position, count)))
                    throw new InvalidDataException(
                        "A retried chunk changed its immutable payload."
                    );
                position += count;
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer, clearArray: true);
        }
    }

    private static FileStream Open(string path, FileMode mode, FileAccess access)
    {
        if (File.Exists(path))
            RejectLink(path);
        return new FileStream(path, mode, access, FileShare.Read, CopyBytes, FileOptions.None);
    }

    private static void RejectLink(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new UnauthorizedAccessException(
                "Private stages cannot use links or reparse points."
            );
    }

    internal sealed record Stage(
        [property: JsonRequired] int SchemaVersion,
        [property: JsonRequired] string Id,
        [property: JsonRequired] string Profile,
        [property: JsonRequired] string EngineIdentity,
        [property: JsonRequired] string OperationId,
        [property: JsonRequired] string Path,
        [property: JsonRequired] string? ExpectedRevision,
        [property: JsonRequired] ulong Size,
        [property: JsonRequired] string Revision,
        [property: JsonRequired] ulong Written,
        [property: JsonRequired] bool Sealed,
        [property: JsonRequired] bool Retired
    );
}
