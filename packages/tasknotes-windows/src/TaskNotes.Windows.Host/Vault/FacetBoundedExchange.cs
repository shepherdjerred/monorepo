using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TaskNotes.Windows.Host;

/// <summary>Durable exchange outcomes. The callback adapter must supply pinned writable capabilities and descriptor identities.</summary>
internal sealed class FacetBoundedExchange
{
    private readonly string _directory;
    private readonly string _profile;
    private readonly string _namespace;
    private readonly FacetBoundedStages _stages;
    private readonly Func<string, string> _resolve;
    private readonly Func<string, string> _fileIdentity;
    private readonly Action<string, string?> _durability;
    private readonly Action<string, string, string> _replace;
    private readonly Action<string>? _checkpoint;
    private readonly object _gate = new();
    private static readonly JsonSerializerOptions Options = new()
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    };

    internal FacetBoundedExchange(
        string directory,
        string profile,
        string engineIdentity,
        FacetBoundedStages stages,
        Func<string, string> resolve,
        Func<string, string> fileIdentity,
        Action<string, string?> durability,
        Action<string>? checkpoint = null,
        Action<string, string, string>? replace = null
    )
    {
        _directory = Path.GetFullPath(directory);
        _profile = profile;
        _namespace = engineIdentity;
        _stages = stages;
        _resolve = resolve;
        _fileIdentity = fileIdentity;
        _durability = durability;
        _replace = replace ?? File.Replace;
        _checkpoint = checkpoint;
        RequireHash(engineIdentity);
        Directory.CreateDirectory(_directory);
        RejectLink(_directory);
    }

    internal Outcome Exchange(
        string profile,
        string operationId,
        string path,
        string? expectedRevision,
        string? stageId
    )
    {
        lock (_gate)
        {
            if (profile != _profile)
                throw new InvalidDataException("The exchange belongs to another vault.");
            if (
                !operationId.StartsWith("facet-write:", StringComparison.Ordinal)
                || operationId.Length != 76
            )
                throw new InvalidDataException("The durable operation identity is invalid.");
            RequireHash(operationId[12..]);
            if (expectedRevision is not null)
                RequireHash(expectedRevision);
            string key = Hash(_namespace + "\0" + profile + "\0" + operationId);
            string manifest = Path.Combine(_directory, key + ".exchange.json");
            Intent intent;
            if (File.Exists(manifest))
            {
                intent = Read(manifest);
                if (
                    intent.OperationId != operationId
                    || intent.Path != path
                    || intent.ExpectedRevision != expectedRevision
                    || intent.StageId != stageId
                )
                    throw new InvalidDataException(
                        "A durable operation cannot change its exchange intent."
                    );
                // Original outcomes survive cleanup/acknowledgement and never
                // consult a destination that may have changed since application.
                if (intent.Outcome is { } observed)
                {
                    return observed;
                }
            }
            else
            {
                string destination = _resolve(path);
                FacetBoundedStages.Stage? stage = stageId is null
                    ? null
                    : _stages.RequireSealed(profile, stageId);
                if (
                    stage is not null
                    && (
                        stage.OperationId != operationId
                        || stage.Path != path
                        || stage.ExpectedRevision != expectedRevision
                    )
                )
                    throw new InvalidDataException(
                        "The sealed stage does not match this exact exchange."
                    );
                // Slot lives beside destination for same-volume atomic moves.
                string slot = Path.Combine(
                    Path.GetDirectoryName(destination)!,
                    ".facet-slot-" + key
                );
                intent = new(
                    1,
                    profile,
                    _namespace,
                    operationId,
                    path,
                    expectedRevision,
                    stageId,
                    slot,
                    key,
                    null,
                    false,
                    null,
                    false
                );
                FacetDurableJson.Write(manifest, intent);
            }
            string target = _resolve(path);
            string backup = Path.Combine(_directory, intent.BackupId + ".captured.bytes");
            if (File.Exists(backup))
            {
                if (intent.PreparedIdentity is null)
                    throw new InvalidDataException(
                        "A captured predecessor exists without a durably prepared exchange."
                    );
                if (!intent.Effected && stageId is not null)
                {
                    // ReplaceFile ERROR_UNABLE_TO_MOVE_REPLACEMENT_2 can move
                    // only the predecessor. Backup existence alone proves no
                    // application. Finish a still-owned slot exclusively or
                    // verify its actual destination identity before success.
                    if (File.Exists(intent.Slot))
                    {
                        if (
                            _fileIdentity(intent.Slot) != intent.PreparedIdentity
                            || File.Exists(target)
                        )
                            throw new InvalidDataException(
                                "The partially completed replacement cannot safely finish. Preserve its slot and predecessor."
                            );
                        Move(intent.Slot, target);
                    }
                    if (!File.Exists(target) || _fileIdentity(target) != intent.PreparedIdentity)
                        throw new InvalidDataException(
                            "The unrecorded replacement destination does not match its prepared identity."
                        );
                }
                intent = RecordEffect(manifest, intent, target, backup);
                return Complete(manifest, intent, true, Capture(intent, backup));
            }
            if (stageId is not null)
            {
                var retained = _stages.RequireSealed(profile, stageId);
                if (
                    retained.OperationId != operationId
                    || retained.Path != path
                    || retained.ExpectedRevision != expectedRevision
                )
                    throw new InvalidDataException(
                        "The retained stage does not own this durable exchange."
                    );
            }
            if (intent.PreparedIdentity is null)
            {
                if (FingerprintOrMissing(target) != expectedRevision)
                    return Complete(manifest, intent, false, null);
                if (stageId is not null)
                {
                    // No filesystem exchange is possible before the prepared
                    // identity commits; an interrupted copy can be replaced.
                    File.Delete(intent.Slot);
                    _stages.CopySealed(profile, stageId, intent.Slot);
                    intent = intent with { PreparedIdentity = _fileIdentity(intent.Slot) };
                }
                else
                    intent = intent with { PreparedIdentity = "tombstone" };
                FacetDurableJson.Write(manifest, intent);
                _checkpoint?.Invoke("prepared");
            }
            if (stageId is not null && !File.Exists(intent.Slot))
            {
                // Create consumed its prepared slot. Absence alone is not an
                // application proof: verify the exact prepared file identity.
                if (
                    expectedRevision is null
                    && File.Exists(target)
                    && _fileIdentity(target) == intent.PreparedIdentity
                )
                {
                    intent = RecordEffect(manifest, intent, target, null);
                    return Complete(manifest, intent, true, null);
                }
                throw new InvalidDataException(
                    "The unrecorded exchange cannot be proven from its retained files. Preserve recovery state."
                );
            }
            if (stageId is not null && _fileIdentity(intent.Slot) != intent.PreparedIdentity)
                throw new InvalidDataException("The prepared exchange slot changed identity.");
            if (FingerprintOrMissing(target) != expectedRevision)
                return Complete(manifest, intent, false, null);
            if (stageId is null)
            {
                if (expectedRevision is not null)
                    Move(target, backup);
            }
            else if (expectedRevision is null)
                Move(intent.Slot, target);
            else
                _replace(intent.Slot, target, backup);
            intent = RecordEffect(manifest, intent, target, File.Exists(backup) ? backup : null);
            _checkpoint?.Invoke("exchanged");
            return Complete(
                manifest,
                intent,
                true,
                File.Exists(backup) ? Capture(intent, backup) : null
            );
        }
    }

    internal Displaced[] Metadata(string? afterId, uint limit)
    {
        lock (_gate)
        {
            if (limit is < 1 or > 128)
                throw new ArgumentOutOfRangeException(nameof(limit));
            if (afterId is not null)
            {
                if (!FacetLegacyBackups.IsLegacyId(afterId))
                    RequireHash(afterId);
            }
            List<Displaced> result = [];
            foreach (
                string captured in Directory
                    .EnumerateFiles(_directory, "*.retained.json")
                    .Order(StringComparer.Ordinal)
            )
            {
                string id = Path.GetFileName(captured)[..^14];
                if (afterId is not null && StringComparer.Ordinal.Compare(id, afterId) <= 0)
                    continue;
                Intent value = Read(Path.Combine(_directory, id + ".exchange.json"));
                if (value.Acknowledged || value.Outcome?.Displaced is not { } metadata)
                    continue;
                using (FileStream marker = OpenRead(captured))
                {
                    if (
                        marker.Length > 65_536
                        || JsonSerializer.Deserialize<Displaced>(marker, Options) != metadata
                    )
                        throw new InvalidDataException(
                            "The retained predecessor marker violates its recorded metadata."
                        );
                }
                if (!File.Exists(Path.Combine(_directory, metadata.Id + ".captured.bytes")))
                    throw new InvalidDataException(
                        "The retained predecessor is missing its captured bytes."
                    );
                result.Add(metadata);
                if (result.Count == limit)
                    break;
            }
            return [.. result];
        }
    }

    internal (Displaced Metadata, string Path) DisplacedSource(string id)
    {
        lock (_gate)
        {
            RequireHash(id);
            Intent intent = Read(Path.Combine(_directory, id + ".exchange.json"));
            if (intent.Acknowledged || intent.Outcome?.Displaced is not { } metadata)
                throw new InvalidDataException(
                    "The predecessor is unknown or already acknowledged."
                );
            return (metadata, Path.Combine(_directory, id + ".captured.bytes"));
        }
    }

    internal void Acknowledge(string id)
    {
        lock (_gate)
        {
            RequireHash(id);
            string manifest = Path.Combine(_directory, id + ".exchange.json");
            Intent intent = Read(manifest);
            if (intent.Outcome?.Displaced is null)
                throw new InvalidDataException(
                    "The exchange has no recorded predecessor to acknowledge."
                );
            if (!intent.Acknowledged)
            {
                FacetDurableJson.Write(manifest, intent with { Acknowledged = true });
            }
            File.Delete(Path.Combine(_directory, id + ".captured.bytes"));
            File.Delete(Path.Combine(_directory, id + ".retained.json"));
        }
    }

    internal void DiscardSlot(string operationId)
    {
        lock (_gate)
        {
            string key = Hash(_namespace + "\0" + _profile + "\0" + operationId);
            string manifest = Path.Combine(_directory, key + ".exchange.json");
            if (!File.Exists(manifest))
                return;
            Intent intent = Read(manifest);
            if (intent.Outcome is null)
                throw new InvalidDataException(
                    "An unresolved exchange cannot discard a potentially captured slot."
                );
            if (File.Exists(intent.Slot))
            {
                if (_fileIdentity(intent.Slot) != intent.PreparedIdentity)
                    throw new InvalidDataException(
                        "The cleanup slot has an unacknowledged predecessor identity."
                    );
                File.Delete(intent.Slot);
            }
        }
    }

    private static void Move(string source, string destination)
    {
        if (OperatingSystem.IsWindows())
            FacetWindowsFileCommit.Move(source, destination, replace: false);
        else
            File.Move(source, destination);
    }

    private Intent RecordEffect(string manifest, Intent intent, string target, string? backup)
    {
        if (intent.Effected)
            return intent;
        // This provider seam flushes both destination and captured predecessor
        // before the durable Effected fence; callers cannot supply a no-op default.
        _durability(target, backup);
        Intent effected = intent with { Effected = true };
        FacetDurableJson.Write(manifest, effected);
        return effected;
    }

    private Outcome Complete(string manifest, Intent intent, bool applied, Displaced? displaced)
    {
        Outcome outcome = new(applied, displaced);
        // RecordEffect commits this fence only after the provider barrier. Its
        // durable receipt also survives a crash before the outcome transaction.
        if (applied && !intent.Effected)
            throw new InvalidDataException(
                "An unpersisted exchange cannot publish an applied outcome."
            );
        // No predecessor is released here. Only the acknowledged-disposition
        // adapter may remove captured bytes; the outcome retains exact metadata.
        if (displaced is not null)
        {
            string retained = Path.Combine(_directory, displaced.Id + ".retained.json");
            FacetDurableJson.Write(retained, displaced);
        }
        FacetDurableJson.Write(manifest, intent with { Outcome = outcome });
        _checkpoint?.Invoke("outcome-recorded");
        return outcome;
    }

    private static Displaced Capture(Intent intent, string backup)
    {
        using FileStream stream = OpenRead(backup);
        return new(
            intent.BackupId,
            intent.Path,
            checked((ulong)stream.Length),
            Convert.ToHexStringLower(SHA256.HashData(stream))
        );
    }

    private Intent Read(string manifest)
    {
        using FileStream stream = OpenRead(manifest);
        if (stream.Length > 65_536)
            throw new InvalidDataException(
                "The private exchange receipt exceeds its metadata limit."
            );
        Intent value =
            JsonSerializer.Deserialize<Intent>(stream, Options)
            ?? throw new InvalidDataException("The exchange receipt is empty.");
        string key = Hash(_namespace + "\0" + _profile + "\0" + value.OperationId);
        if (
            value.SchemaVersion != 1
            || value.Profile != _profile
            || value.EngineIdentity != _namespace
            || value.BackupId != key
            || Path.GetFileName(manifest) != key + ".exchange.json"
        )
            throw new InvalidDataException(
                "The exchange receipt has an invalid owner or identity."
            );
        string destination = _resolve(value.Path);
        string slot = Path.Combine(Path.GetDirectoryName(destination)!, ".facet-slot-" + key);
        if (
            value.Slot != slot
            || (value.Effected && value.PreparedIdentity is null)
            || (value.Outcome is { Applied: true } && !value.Effected)
            || (value.Acknowledged && value.Outcome?.Displaced is null)
        )
            throw new InvalidDataException("The exchange receipt has an invalid prepared state.");
        if (value.Outcome?.Displaced is { } displaced)
        {
            RequireHash(displaced.Revision);
            if (
                displaced.Id != key
                || displaced.Path != value.Path
                || displaced.Size > long.MaxValue
                || !value.Outcome.Applied
            )
                throw new InvalidDataException(
                    "The captured predecessor receipt has invalid metadata."
                );
        }
        return value;
    }

    private static string? FingerprintOrMissing(string path)
    {
        try
        {
            using FileStream stream = OpenRead(path);
            return Convert.ToHexStringLower(SHA256.HashData(stream));
        }
        catch (FileNotFoundException)
        {
            return null;
        }
    }

    private static FileStream OpenRead(string path)
    {
        RejectLink(path);
        return new(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete,
            65_536
        );
    }

    private static void RejectLink(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new UnauthorizedAccessException("Private exchange files cannot use links.");
    }

    private static string Hash(string value) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    private static void RequireHash(string value)
    {
        if (value.Length != 64 || value.Any(c => !(c is >= '0' and <= '9' or >= 'a' and <= 'f')))
            throw new InvalidDataException("An exact lowercase SHA256 is required.");
    }

    internal sealed record Displaced(
        [property: JsonRequired] string Id,
        [property: JsonRequired] string Path,
        [property: JsonRequired] ulong Size,
        [property: JsonRequired] string Revision
    );

    internal sealed record Outcome(
        [property: JsonRequired] bool Applied,
        [property: JsonRequired] Displaced? Displaced
    );

    private sealed record Intent(
        [property: JsonRequired] int SchemaVersion,
        [property: JsonRequired] string Profile,
        [property: JsonRequired] string EngineIdentity,
        [property: JsonRequired] string OperationId,
        [property: JsonRequired] string Path,
        [property: JsonRequired] string? ExpectedRevision,
        [property: JsonRequired] string? StageId,
        [property: JsonRequired] string Slot,
        [property: JsonRequired] string BackupId,
        [property: JsonRequired] string? PreparedIdentity,
        [property: JsonRequired] bool Effected,
        [property: JsonRequired] Outcome? Outcome,
        [property: JsonRequired] bool Acknowledged
    );
}
