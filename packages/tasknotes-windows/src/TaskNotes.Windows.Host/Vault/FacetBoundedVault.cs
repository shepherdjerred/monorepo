namespace TaskNotes.Windows.Host;

/// <summary>Concrete capability owner for the proposed bounded callbacks; generated61 conversion stays outside this class.</summary>
internal sealed class FacetBoundedVault : IDisposable
{
    private readonly string _profile;
    private readonly string _directory;
    private readonly Func<string, string> _resolve;
    private readonly Func<string, IDisposable> _pinDirectory;
    private readonly Func<string, FileStream?> _openRead;
    private readonly Action _requireWritable;
    private readonly Action<string> _ensureParents;
    private readonly string _sourceRoot;
    private readonly FacetBoundedStages _stages;
    private readonly FacetBoundedSnapshots _snapshots;
    private readonly FacetBoundedExchange _exchange;
    private readonly FacetLegacyBackups? _legacy;
    private readonly object _gate = new();
    private bool _closed;

    internal FacetBoundedVault(
        string directory,
        string profile,
        string engineIdentity,
        string sourceRoot,
        Func<string, string> resolve,
        Func<string, IDisposable> pinDirectory,
        Func<string, FileStream?> openRead,
        Action requireWritable,
        Action<string> ensureParents,
        Func<FileStream, string> fileIdentity,
        Action<string, string?> durability,
        FacetLegacyBackups? legacy = null
    )
    {
        _profile = profile;
        _directory = Path.GetFullPath(directory);
        _resolve = resolve;
        _pinDirectory = pinDirectory;
        _openRead = openRead;
        _requireWritable = requireWritable;
        _ensureParents = ensureParents;
        _sourceRoot = sourceRoot;
        _legacy = legacy;
        Directory.CreateDirectory(_directory);
        using var pins = _pinDirectory(_directory);
        _stages = new(Path.Combine(_directory, "stages"), profile, engineIdentity);
        _snapshots = new(Path.Combine(_directory, "read-images"), profile, identity: fileIdentity);
        _exchange = new(
            Path.Combine(_directory, "exchanges"),
            profile,
            engineIdentity,
            _stages,
            resolve,
            path =>
            {
                using FileStream stream =
                    openRead(path)
                    ?? throw new FileNotFoundException("The prepared descriptor is missing.");
                return fileIdentity(stream);
            },
            durability
        );
    }

    internal FacetBoundedSnapshots.Snapshot? OpenFileSnapshot(string profile, string path)
    {
        lock (_gate)
        {
            RequireOwner(profile);
            using var rootPins = _pinDirectory(_sourceRoot);
            string source = _resolve(path);
            using var privatePins = _pinDirectory(_directory);
            try
            {
                _ = File.GetAttributes(Path.GetDirectoryName(source)!);
            }
            catch (Exception failure)
                when (failure is FileNotFoundException or DirectoryNotFoundException)
            {
                return null;
            }
            using var sourcePins = _pinDirectory(Path.GetDirectoryName(source)!);
            return _snapshots.Capture(profile, () => _openRead(source));
        }
    }

    internal FacetBoundedSnapshots.Snapshot OpenDisplacedSnapshot(string profile, string id)
    {
        lock (_gate)
        {
            RequireOwner(profile);
            using var pins = _pinDirectory(_directory);
            var displaced =
                FacetLegacyBackups.IsLegacyId(id) && _legacy is not null
                    ? _legacy.Source(id)
                    : _exchange.DisplacedSource(id);
            return _snapshots.Capture(
                    profile,
                    () => _openRead(displaced.Path),
                    displaced.Metadata.Size,
                    displaced.Metadata.Revision
                ) ?? throw new InvalidDataException("The retained predecessor is missing.");
        }
    }

    internal byte[] ReadSnapshotChunk(string profile, string id, ulong offset, uint length)
    {
        lock (_gate)
        {
            RequireOwner(profile);
            using var pins = _pinDirectory(_directory);
            return _snapshots.Read(profile, id, offset, length);
        }
    }

    internal void CloseSnapshot(string profile, string id)
    {
        lock (_gate)
        {
            RequireOwner(profile);
            using var pins = _pinDirectory(_directory);
            _snapshots.Close(profile, id);
        }
    }

    internal FacetBoundedStages.Stage BeginReplacement(
        string profile,
        string operation,
        string path,
        string? expected,
        ulong size,
        string revision
    )
    {
        lock (_gate)
        {
            RequireOwner(profile);
            _requireWritable();
            _resolve(path);
            using var pins = _pinDirectory(_directory);
            return _stages.Begin(profile, operation, path, expected, size, revision);
        }
    }

    internal FacetBoundedStages.Stage WriteReplacementChunk(
        string profile,
        string id,
        ulong offset,
        byte[] bytes
    )
    {
        lock (_gate)
        {
            RequireOwner(profile);
            _requireWritable();
            using var pins = _pinDirectory(_directory);
            return _stages.Write(profile, id, offset, bytes);
        }
    }

    internal FacetBoundedStages.Stage SealReplacement(string profile, string id)
    {
        lock (_gate)
        {
            RequireOwner(profile);
            _requireWritable();
            using var pins = _pinDirectory(_directory);
            return _stages.Seal(profile, id);
        }
    }

    internal FacetBoundedExchange.Outcome CompareExchangeStaged(
        string profile,
        string operation,
        string path,
        string? expected,
        string? stageId
    )
    {
        lock (_gate)
        {
            RequireOwner(profile);
            _requireWritable();
            using var rootPins = _pinDirectory(_sourceRoot);
            string target = _resolve(path);
            _ensureParents(path);
            using var privatePins = _pinDirectory(_directory);
            using var targetPins = _pinDirectory(Path.GetDirectoryName(target)!);
            return _exchange.Exchange(profile, operation, path, expected, stageId);
        }
    }

    internal void DiscardReplacement(string profile, string id)
    {
        lock (_gate)
        {
            RequireOwner(profile);
            _requireWritable();
            using var pins = _pinDirectory(_directory);
            var receipt = _stages.Receipt(profile, id);
            _exchange.DiscardSlot(receipt.OperationId);
            _stages.Discard(profile, id);
        }
    }

    internal FacetBoundedExchange.Displaced[] DisplacedMetadata(
        string profile,
        string? afterId,
        uint limit
    )
    {
        lock (_gate)
        {
            RequireOwner(profile);
            using var pins = _pinDirectory(_directory);
            var current = _exchange.Metadata(afterId, limit);
            var previous = _legacy?.Metadata(afterId, limit) ?? [];
            return current
                .Concat(previous)
                .OrderBy(row => row.Id, StringComparer.Ordinal)
                .Take(checked((int)limit))
                .ToArray();
        }
    }

    internal void AcknowledgeDisplaced(string profile, string id)
    {
        lock (_gate)
        {
            RequireOwner(profile);
            _requireWritable();
            using var pins = _pinDirectory(_directory);
            if (FacetLegacyBackups.IsLegacyId(id) && _legacy is not null)
                _legacy.Acknowledge(id);
            else
                _exchange.Acknowledge(id);
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_closed)
                return;
            _closed = true;
            // Called only after engine callback drain; durable stages/outcomes
            // stay on disk for the next owner rather than being disposed away.
            _snapshots.Dispose();
        }
        GC.SuppressFinalize(this);
    }

    private void RequireOwner(string profile)
    {
        ObjectDisposedException.ThrowIf(_closed, this);
        if (profile != _profile)
            throw new InvalidDataException("The bounded capability belongs to another profile.");
    }
}
