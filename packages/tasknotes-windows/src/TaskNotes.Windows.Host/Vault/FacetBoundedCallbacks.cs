using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Host;

/// <summary>Callback ownership without strong engine/session references. Close only after CloseRuntime drains.</summary>
internal sealed class FacetBoundedCallbacks : Core.FacetVaultFiles, IDisposable
{
    private readonly FacetVaultFiles _files;
    private readonly string _directory;
    private readonly Func<string, string, string, FacetBoundedVault> _factory;
    private readonly Dictionary<string, FacetBoundedVault> _owners = new(StringComparer.Ordinal);
    private readonly object _gate = new();
    private string? _identity;
    private bool _closed;

    internal FacetBoundedCallbacks(
        FacetVaultFiles files,
        string directory,
        Func<string, string, string, FacetBoundedVault>? factory = null
    )
    {
        _files = files;
        _directory = Path.GetFullPath(directory);
        _factory =
            factory
            ?? (
                (profile, identity, metadata) =>
                    files.OpenBoundedCapability(profile, identity, metadata)
            );
    }

    internal void BindRuntimeIdentity(string identity)
    {
        lock (_gate)
        {
            if (
                _closed
                || identity.Length != 64
                || identity.Any(character =>
                    character is not (>= '0' and <= '9') and not (>= 'a' and <= 'f')
                )
                || (_identity is not null && _identity != identity)
            )
                throw new Core.FacetHostException.Contract("bounded_engine_identity_invalid");
            _identity = identity;
        }
    }

    private FacetBoundedVault Owner(string profile)
    {
        lock (_gate)
        {
            RequireOpen();
            if (!_owners.TryGetValue(profile, out var owner))
            {
                string key = Convert.ToHexStringLower(
                    SHA256.HashData(Encoding.UTF8.GetBytes(profile))
                );
                owner = _factory(profile, _identity!, Path.Combine(_directory, _identity!, key));
                _owners.Add(profile, owner);
            }
            return owner;
        }
    }

    public string[] ListFiles(string profileId) =>
        Boundary(() =>
        {
            lock (_gate)
                RequireOpen();
            return _files.ListFiles(profileId);
        });

    public Core.FacetFileSnapshot? OpenFileSnapshot(string profileId, string path) =>
        Boundary(() =>
            Owner(profileId).OpenFileSnapshot(profileId, path) is { } snapshot
                ? Snapshot(snapshot)
                : null
        );

    public Core.FacetFileSnapshot OpenDisplacedSnapshot(string profileId, string backupId) =>
        Boundary(() => Snapshot(Owner(profileId).OpenDisplacedSnapshot(profileId, backupId)));

    public byte[] ReadSnapshotChunk(
        string profileId,
        string snapshotId,
        ulong offset,
        uint length
    ) => Boundary(() => Owner(profileId).ReadSnapshotChunk(profileId, snapshotId, offset, length));

    public void CloseSnapshot(string profileId, string snapshotId) =>
        Boundary(() => Owner(profileId).CloseSnapshot(profileId, snapshotId));

    public Core.FacetReplacementStage BeginReplacement(
        string profileId,
        string operationId,
        string path,
        string? expectedRevision,
        ulong size,
        string revision
    ) =>
        Boundary(() =>
            Stage(
                Owner(profileId)
                    .BeginReplacement(
                        profileId,
                        operationId,
                        path,
                        expectedRevision,
                        size,
                        revision
                    )
            )
        );

    public Core.FacetReplacementStage WriteReplacementChunk(
        string profileId,
        string stageId,
        ulong offset,
        byte[] bytes
    ) =>
        Boundary(() =>
            Stage(Owner(profileId).WriteReplacementChunk(profileId, stageId, offset, bytes))
        );

    public Core.FacetReplacementStage SealReplacement(string profileId, string stageId) =>
        Boundary(() => Stage(Owner(profileId).SealReplacement(profileId, stageId)));

    public Core.FacetStagedExchange CompareExchangeStaged(
        string profileId,
        string operationId,
        string path,
        string? expectedRevision,
        string? stageId
    ) =>
        Boundary(() =>
        {
            var result = Owner(profileId)
                .CompareExchangeStaged(profileId, operationId, path, expectedRevision, stageId);
            return new Core.FacetStagedExchange(
                result.Applied,
                result.Displaced is { } metadata ? Metadata(metadata) : null
            );
        });

    public void DiscardReplacement(string profileId, string stageId) =>
        Boundary(() => Owner(profileId).DiscardReplacement(profileId, stageId));

    public Core.FacetDisplacedMetadata[] DisplacedMetadata(
        string profileId,
        string? afterId,
        uint limit
    ) =>
        Boundary(() =>
        {
            if (limit is < 1 or > 128)
                throw new Core.FacetHostException.Contract("bounded_metadata_limit_invalid");
            return Owner(profileId)
                .DisplacedMetadata(profileId, afterId, limit)
                .Select(Metadata)
                .ToArray();
        });

    public void AcknowledgeDisplaced(string profileId, string id) =>
        Boundary(() => Owner(profileId).AcknowledgeDisplaced(profileId, id));

    /// <summary>Only after successful core deletion and stopped/unbound sessions; never deletes vault content.</summary>
    internal void DetachProfile(string profileId)
    {
        FacetBoundedVault? retired;
        lock (_gate)
            _owners.Remove(profileId, out retired);
        retired?.Dispose();
    }

    public void Dispose()
    {
        FacetBoundedVault[] owners;
        lock (_gate)
        {
            if (_closed)
                return;
            _closed = true;
            owners = _owners.Values.ToArray();
            _owners.Clear();
        }
        Exception? first = null;
        foreach (var owner in owners)
            try
            {
                owner.Dispose();
            }
            catch (Exception failure)
            {
                first = first is null ? failure : new AggregateException(first, failure);
            }
        GC.SuppressFinalize(this);
        if (first is not null)
            System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(first).Throw();
    }

    private void RequireOpen()
    {
        if (_closed || _identity is null)
            throw new Core.FacetHostException.Contract("bounded_callback_owner_unavailable");
    }

    private static Core.FacetFileSnapshot Snapshot(FacetBoundedSnapshots.Snapshot value) =>
        new(value.Id, value.Size, value.Revision);

    private static Core.FacetReplacementStage Stage(FacetBoundedStages.Stage value) =>
        new(
            value.Id,
            value.OperationId,
            value.Path,
            value.Size,
            value.Revision,
            value.Written,
            value.Sealed
        );

    private static Core.FacetDisplacedMetadata Metadata(FacetBoundedExchange.Displaced value) =>
        new(value.Id, value.Path, value.Size, value.Revision);

    private static void Boundary(Action action) =>
        Boundary(() =>
        {
            action();
            return true;
        });

    private static T Boundary<T>(Func<T> action)
    {
        try
        {
            return action();
        }
        catch (Exception failure)
            when (failure
                    is InvalidDataException
                        or JsonException
                        or ArgumentException
                        or InvalidOperationException
            )
        {
            throw new Core.FacetHostException.Contract("bounded_private_contract_invalid");
        }
        catch (UnauthorizedAccessException)
        {
            throw new Core.FacetHostException.PermissionDenied(
                "Restore access to the selected vault folder."
            );
        }
        catch (PlatformNotSupportedException)
        {
            throw new Core.FacetHostException.Unavailable(
                "The vault provider cannot supply the required descriptor or durability capability."
            );
        }
        catch (IOException)
        {
            throw new Core.FacetHostException.Io("The durable vault filesystem operation failed.");
        }
    }
}
