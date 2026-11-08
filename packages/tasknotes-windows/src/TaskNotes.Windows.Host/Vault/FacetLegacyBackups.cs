using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TaskNotes.Windows.Host;

/// <summary>Bounded access to recorded backups from the previous callback ABI.</summary>
internal sealed class FacetLegacyBackups
{
    private readonly string _directory;
    private readonly string _receipts;
    private readonly string _profile;
    private readonly string _engineIdentity;
    private readonly Func<string, FileStream?> _open;
    private readonly Func<string, string> _resolve;
    private readonly Action<string> _checkpoint;
    private readonly Action _requireWritable;
    private readonly Func<string, IDisposable>? _pinDirectory;
    private static readonly JsonSerializerOptions Options = new()
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    };

    internal FacetLegacyBackups(
        string directory,
        string receipts,
        string profile,
        string engineIdentity,
        Func<string, FileStream?> open,
        Func<string, string> resolve,
        Action<string>? checkpoint = null,
        Action? requireWritable = null,
        Func<string, IDisposable>? pinDirectory = null
    )
    {
        _directory = directory;
        _receipts = receipts;
        _profile = profile;
        _engineIdentity = engineIdentity;
        _open = open;
        _resolve = resolve;
        _checkpoint = checkpoint ?? (_ => { });
        _requireWritable = requireWritable ?? (() => { });
        _pinDirectory = pinDirectory;
        if (
            engineIdentity.Length != 64
            || engineIdentity.Any(c => !(c is >= '0' and <= '9' or >= 'a' and <= 'f'))
        )
            throw new InvalidDataException("The engine namespace is invalid.");
        Directory.CreateDirectory(receipts);
    }

    internal static bool IsLegacyId(string id) => Guid.TryParseExact(id, "N", out _);

    internal FacetBoundedExchange.Displaced[] Metadata(string? afterId, uint limit)
    {
        if (limit is < 1 or > 128)
            throw new ArgumentOutOfRangeException(nameof(limit));
        if (!Directory.Exists(_directory))
            return [];
        using var pins = _pinDirectory?.Invoke(_directory);
        using var receiptPins = _pinDirectory?.Invoke(_receipts);
        List<FacetBoundedExchange.Displaced> result = [];
        foreach (
            string path in Directory
                .EnumerateFiles(_directory, "*.json")
                .Order(StringComparer.Ordinal)
        )
        {
            string id = Path.GetFileNameWithoutExtension(path);
            RequireId(id);
            if (afterId is not null && StringComparer.Ordinal.Compare(id, afterId) <= 0)
                continue;
            if (Acknowledged(id) is { } observed)
            {
                Cleanup(observed);
                continue;
            }
            result.Add(Source(id).Metadata);
            if (result.Count == limit)
                break;
        }
        return result.ToArray();
    }

    internal (FacetBoundedExchange.Displaced Metadata, string Path) Source(string id)
    {
        using var pins = _pinDirectory?.Invoke(_directory);
        using var receiptPins = _pinDirectory?.Invoke(_receipts);
        RequireId(id);
        if (Acknowledged(id) is not null)
            throw new InvalidDataException("The legacy predecessor has been acknowledged.");
        string metadataPath = Path.Combine(_directory, id + ".json");
        Entry entry =
            Read<Entry>(metadataPath)
            ?? throw new InvalidDataException("The legacy backup metadata is missing.");
        if (string.IsNullOrWhiteSpace(entry.Path))
            throw new InvalidDataException("The legacy backup path is invalid.");
        _resolve(entry.Path);
        string source = Path.Combine(_directory, id + ".bytes");
        using FileStream stream =
            _open(source)
            ?? throw new uniffi.TaskNotesCore.FacetHostException.Unavailable(
                "A legacy recovery record is missing its captured file. Current destination bytes cannot prove its original outcome."
            );
        ulong size = checked((ulong)stream.Length);
        if (entry.Size is null && entry.Revision is null)
        {
            _requireWritable();
            entry = entry with
            {
                Size = size,
                Revision = Convert.ToHexStringLower(SHA256.HashData(stream)),
            };
            FacetDurableJson.Write(metadataPath, entry);
        }
        if (
            entry.Size != size
            || entry.Revision is null
            || entry.Revision.Length != 64
            || entry.Revision.Any(c => !(c is >= '0' and <= '9' or >= 'a' and <= 'f'))
        )
            throw new InvalidDataException("The retained legacy backup changed.");
        // Sealed metadata enumeration never hashes full attachments. The
        // bounded snapshot verifies these exact bytes while copying; ACK
        // verifies them before deletion.
        return (new(id, entry.Path, size, entry.Revision), source);
    }

    internal void Acknowledge(string id)
    {
        using var pins = _pinDirectory?.Invoke(_directory);
        using var receiptPins = _pinDirectory?.Invoke(_receipts);
        _requireWritable();
        RequireId(id);
        Receipt? receipt = Acknowledged(id);
        if (receipt is null)
        {
            receipt = new(_profile, _engineIdentity, Source(id).Metadata);
            // Commit ownership/disposition before either retained file can vanish.
            FacetDurableJson.Write(ReceiptPath(id), receipt);
            _checkpoint("acknowledged");
        }
        Cleanup(receipt);
    }

    private void Cleanup(Receipt receipt)
    {
        using var pins = _pinDirectory?.Invoke(_directory);
        _requireWritable();
        string id = receipt.Metadata.Id;
        string metadataPath = Path.Combine(_directory, id + ".json");
        Entry? entry = Read<Entry>(metadataPath);
        if (
            entry is not null
            && (
                entry.Path != receipt.Metadata.Path
                || entry.Size != receipt.Metadata.Size
                || entry.Revision != receipt.Metadata.Revision
            )
        )
            throw new InvalidDataException("The acknowledged legacy backup identity changed.");
        string source = Path.Combine(_directory, id + ".bytes");
        using (FileStream? stream = _open(source))
            if (
                stream is not null
                && (
                    checked((ulong)stream.Length) != receipt.Metadata.Size
                    || Convert.ToHexStringLower(SHA256.HashData(stream))
                        != receipt.Metadata.Revision
                )
            )
                throw new InvalidDataException("The acknowledged legacy backup bytes changed.");
        File.Delete(source);
        _checkpoint("bytes-removed");
        File.Delete(metadataPath);
        _checkpoint("metadata-removed");
    }

    private Receipt? Acknowledged(string id)
    {
        Receipt? value = Read<Receipt>(ReceiptPath(id));
        if (
            value is not null
            && (
                value.Profile != _profile
                || value.EngineIdentity != _engineIdentity
                || value.Metadata is null
                || value.Metadata.Id != id
            )
        )
            throw new InvalidDataException("The legacy acknowledgement belongs to another owner.");
        if (value is not null)
        {
            if (string.IsNullOrWhiteSpace(value.Metadata.Path))
                throw new InvalidDataException("The legacy acknowledgement path is invalid.");
            _resolve(value.Metadata.Path);
            if (
                value.Metadata.Revision is null
                || value.Metadata.Revision.Length != 64
                || value.Metadata.Revision.Any(c => !(c is >= '0' and <= '9' or >= 'a' and <= 'f'))
            )
                throw new InvalidDataException("The legacy acknowledgement hash is invalid.");
        }
        return value;
    }

    private T? Read<T>(string path)
        where T : class
    {
        using FileStream? stream = _open(path);
        if (stream is null)
            return null;
        if (stream.Length > 65_536)
            throw new InvalidDataException("Legacy backup metadata exceeds its bound.");
        long size = stream.Length;
        _checkpoint("metadata-opened");
        byte[] bytes = new byte[checked((int)size)];
        stream.ReadExactly(bytes);
        if (stream.ReadByte() != -1 || stream.Length != size)
            throw new InvalidDataException(
                "Legacy backup metadata changed during its bounded read."
            );
        return JsonSerializer.Deserialize<T>(bytes, Options)
            ?? throw new InvalidDataException("Legacy backup metadata is corrupt.");
    }

    private string ReceiptPath(string id) =>
        Path.Combine(
            _receipts,
            Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(id))) + ".json"
        );

    private static void RequireId(string id)
    {
        if (!IsLegacyId(id))
            throw new InvalidDataException("The legacy backup identity is invalid.");
    }

    private sealed record Entry(
        [property: JsonRequired] string Path,
        ulong? Size = null,
        string? Revision = null
    );

    private sealed record Receipt(
        [property: JsonRequired] string Profile,
        [property: JsonRequired] string EngineIdentity,
        [property: JsonRequired] FacetBoundedExchange.Displaced Metadata
    );
}
