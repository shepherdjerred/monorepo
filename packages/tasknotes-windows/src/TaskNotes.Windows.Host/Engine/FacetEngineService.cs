using System.Security.Cryptography;
using System.Text.Json;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Host;

/// <summary>Restored native capability; private replicas have exclusive app ownership.</summary>
public sealed record FacetFolderCapability(string ProfileId, string RootPath, bool PrivateReplica);

/// <summary>Worker-bound standalone engine facade. Rust owns all domain documents.</summary>
public sealed class FacetEngineService : IAsyncDisposable
{
    private readonly EngineRunner _runner = new();
    private readonly FacetVaultFiles _files = new();
    private readonly FacetBoundedCallbacks _callbacks;
    private readonly string _databasePath;
    private readonly FacetSchema _schema = FacetSchema.Bundled();
    private readonly Dictionary<string, string> _unavailable = new(StringComparer.Ordinal);
    private Core.FfiFacetEngine? _engine;
    private bool _closed;
    private readonly object _disposeGate = new();
    private Task? _disposeTask;

    /// <summary>Restore explicit capabilities before opening the private SQLite index.</summary>
    public FacetEngineService(string databasePath, IEnumerable<FacetFolderCapability> capabilities)
        : this(databasePath, capabilities, null) { }

    internal FacetEngineService(
        string databasePath,
        IEnumerable<FacetFolderCapability> capabilities,
        Func<FacetVaultFiles, string, string, string, FacetBoundedVault>? capabilityFactory
    )
    {
        _databasePath = databasePath;
        _callbacks = new(
            _files,
            databasePath + ".capabilities",
            capabilityFactory is null
                ? null
                : (profile, identity, directory) =>
                    capabilityFactory(_files, profile, identity, directory)
        );
        foreach (var capability in capabilities)
        {
            try
            {
                _files.Register(
                    capability.ProfileId,
                    capability.RootPath,
                    capability.PrivateReplica
                );
            }
            catch (Core.FacetHostException error)
            {
                _unavailable[capability.ProfileId] = error.GetType().Name;
            }
        }
    }

    /// <summary>Open/create the SQLite index on the serial background worker.</summary>
    public Task InitializeAsync(CancellationToken cancellationToken = default) =>
        _runner.RunAsync(
            () =>
            {
                ObjectDisposedException.ThrowIf(_closed, this);
                if (_engine is null)
                {
                    _engine = new Core.FfiFacetEngine(_databasePath, _callbacks);
                    _callbacks.BindRuntimeIdentity(_engine.Identity());
                }
                return true;
            },
            cancellationToken
        );

    /// <summary>Register a schema-versioned Rust profile document and its native capability.</summary>
    public Task<string> RegisterProfileAsync(
        string id,
        string name,
        string rootPath,
        bool privateReplica,
        bool approveStandard,
        CancellationToken cancellationToken = default
    ) =>
        _runner.RunAsync(
            () =>
            {
                bool existed;
                using (
                    JsonDocument profiles = JsonDocument.Parse(
                        Validated(Engine.ProfilesJson(), "profiles")
                    )
                )
                    existed = profiles
                        .RootElement.GetProperty("profiles")
                        .EnumerateArray()
                        .Any(p => p.GetProperty("id").GetString() == id);
                _files.Register(id, rootPath, privateReplica);
                _unavailable.Remove(id);
                string document = JsonSerializer.Serialize(
                    new
                    {
                        schemaVersion = 1,
                        id,
                        name,
                        kind = privateReplica ? "obsidian_sync" : "local_folder",
                        approveStandard,
                    }
                );
                _schema.Validate(document, "profile");
                try
                {
                    return Validated(Engine.RegisterProfile(document), "profile");
                }
                catch
                {
                    if (!existed)
                        _files.Unregister(id);
                    throw;
                }
            },
            cancellationToken
        );

    /// <summary>List persisted profiles without exposing capabilities or credentials.</summary>
    public Task<string> ProfilesAsync(CancellationToken cancellationToken = default) =>
        _runner.RunAsync(() => Validated(Engine.ProfilesJson(), "profiles"), cancellationToken);

    /// <summary>Caller must first stop/unbind sessions. Rejected deletion keeps callback capability ownership.</summary>
    public Task RemoveProfileAsync(
        string profileId,
        CancellationToken cancellationToken = default
    ) =>
        _runner.RunAsync(
            () =>
            {
                Engine.RemoveProfile(profileId);
                _callbacks.DetachProfile(profileId);
                _files.Unregister(profileId);
                _unavailable.Remove(profileId);
                return true;
            },
            cancellationToken
        );

    /// <summary>Index provider changes and recover retained versions.</summary>
    public Task<string> RefreshAsync(
        string profileId,
        CancellationToken cancellationToken = default
    ) =>
        _runner.RunAsync(() => Validated(Engine.Refresh(profileId), "snapshot"), cancellationToken);

    /// <summary>Read a versioned, paged snapshot using shared query semantics.</summary>
    public Task<string> SnapshotAsync(
        string profileId,
        string queryJson,
        CancellationToken cancellationToken = default
    ) =>
        _runner.RunAsync(
            () =>
            {
                _schema.Validate(queryJson, "query");
                return Validated(Engine.SnapshotJson(profileId, queryJson), "snapshot");
            },
            cancellationToken
        );

    /// <summary>Execute an idempotent versioned Rust mutation document.</summary>
    public Task<string> ExecuteAsync(
        string profileId,
        string mutationJson,
        CancellationToken cancellationToken = default
    ) =>
        _runner.RunAsync(
            () =>
            {
                _schema.Validate(mutationJson, "mutation");
                return Validated(Engine.Execute(profileId, mutationJson), "receipt");
            },
            cancellationToken
        );

    /// <summary>Apply a versioned replacement decision with a separately owned binary payload.</summary>
    public Task<string> ExecutePayloadAsync(
        string profileId,
        string mutationJson,
        byte[]? payload,
        CancellationToken cancellationToken = default
    ) =>
        _runner.RunAsync(
            () =>
            {
                _schema.Validate(mutationJson, "mutation");
                if (payload is null)
                    return Validated(
                        Engine.ExecutePayloadIdJson(profileId, mutationJson, null),
                        "receipt"
                    );
                using var mutation = JsonDocument.Parse(mutationJson);
                string revision = Convert.ToHexStringLower(SHA256.HashData(payload));
                string id =
                    "draft:"
                    + mutation.RootElement.GetProperty("mutationId").GetString()
                    + ":"
                    + revision;
                return WithPayload(
                    Engine.BeginPayload(
                        profileId,
                        id,
                        checked((ulong)payload.LongLength),
                        revision
                    ),
                    handle =>
                    {
                        using var metadata = JsonDocument.Parse(
                            Validated(handle.InfoJson(), "payloadInfo")
                        );
                        var info = metadata.RootElement;
                        ulong size = checked((ulong)payload.LongLength);
                        if (
                            info.GetProperty("id").GetString() != id
                            || info.GetProperty("size").GetUInt64() != size
                            || info.GetProperty("revision").GetString() != revision
                        )
                            throw new InvalidDataException(
                                "The durable replacement identity changed."
                            );
                        ulong offset = info.GetProperty("written").GetUInt64();
                        string state = info.GetProperty("state").GetString()!;
                        if (state == "discarded")
                            throw new InvalidOperationException(
                                "This replacement was explicitly retired. Start a new reviewed action."
                            );
                        if (state == "preparing")
                        {
                            while (offset < size)
                            {
                                int count = checked(
                                    (int)
                                        Math.Min(
                                            (ulong)FacetBoundedStages.ChunkBytes,
                                            size - offset
                                        )
                                );
                                byte[] chunk = payload
                                    .AsSpan(checked((int)offset), count)
                                    .ToArray();
                                using var written = JsonDocument.Parse(
                                    Validated(handle.WriteChunk(offset, chunk), "payloadInfo")
                                );
                                if (
                                    written.RootElement.GetProperty("written").GetUInt64()
                                    != offset + checked((ulong)count)
                                )
                                    throw new InvalidDataException(
                                        "The durable replacement prefix did not advance exactly."
                                    );
                                offset += checked((ulong)count);
                            }
                            _ = Validated(handle.Seal(), "payloadInfo");
                        }
                        return Validated(
                            Engine.ExecutePayloadIdJson(profileId, mutationJson, handle),
                            "receipt"
                        );
                    }
                );
            },
            cancellationToken
        );

    /// <summary>Read shared NLP, discovery and mutation state.</summary>
    public Task<string> FeaturesAsync(
        string profileId,
        string requestJson,
        CancellationToken cancellationToken = default
    ) =>
        _runner.RunAsync(
            () =>
            {
                _schema.Validate(requestJson, "featureRequest");
                using var document = JsonDocument.Parse(requestJson);
                string definition = document.RootElement.GetProperty("kind").GetString() switch
                {
                    "capture_preview" => "capturePreview",
                    "discovery" => "discovery",
                    "mutation_receipt" => "mutationReceipt",
                    "resolution_history" => "resolutionHistory",
                    "undo_available" => "undoAvailable",
                    "batch_outcome" => "batchOutcome",
                    "normalization_preview" => "normalizationPreview",
                    "conformance" => "conformance",
                    "reminder_plan" => "reminderPlan",
                    _ => throw new InvalidDataException("Unknown Facet feature request."),
                };
                return Validated(Engine.FeaturesJson(profileId, requestJson), definition);
            },
            cancellationToken
        );

    /// <summary>Read preserved overlaps for native conflict presentation.</summary>
    public Task<string> ConflictsAsync(
        string profileId,
        CancellationToken cancellationToken = default
    ) =>
        _runner.RunAsync(
            () => Validated(Engine.ConflictsJson(profileId), "conflicts"),
            cancellationToken
        );

    /// <summary>Read one bounded page of retained conflict metadata.</summary>
    public Task<string> ConflictsPageAsync(
        string profileId,
        string? afterId,
        CancellationToken cancellationToken = default
    ) =>
        _runner.RunAsync(
            () => Validated(Engine.ConflictsPageJson(profileId, afterId, 128), "conflicts"),
            cancellationToken
        );

    /// <summary>Read one immutable conflict version through the binary boundary.</summary>
    public Task<byte[]?> ReadConflictPayloadAsync(
        string profileId,
        string id,
        string version,
        CancellationToken cancellationToken = default
    ) =>
        _runner.RunAsync(
            () =>
            {
                var handle = Engine.ConflictPayload(profileId, id, version);
                if (handle is null)
                    return null;
                return WithPayload(
                    handle,
                    payload =>
                    {
                        using var info = JsonDocument.Parse(
                            Validated(payload.InfoJson(), "payloadInfo")
                        );
                        ulong size = info.RootElement.GetProperty("size").GetUInt64();
                        if (info.RootElement.GetProperty("state").GetString() != "sealed")
                            throw new InvalidDataException(
                                "The retained conflict version is not immutable."
                            );
                        if (size > FacetBoundedStages.ChunkBytes)
                            throw new InvalidOperationException(
                                "This version exceeds the text preview limit. Its full retained bytes remain available to conflict choices."
                            );
                        byte[] bytes = payload.ReadChunk(0, checked((uint)size));
                        if (checked((ulong)bytes.LongLength) != size)
                            throw new InvalidDataException(
                                "The retained conflict range is incomplete."
                            );
                        return bytes;
                    }
                );
            },
            cancellationToken
        );

    private static T WithPayload<T>(
        Core.FfiFacetPayload payload,
        Func<Core.FfiFacetPayload, T> operation
    )
    {
        Exception? first = null;
        T result = default!;
        try
        {
            result = operation(payload);
        }
        catch (Exception failure)
        {
            first = failure;
        }
        try
        {
            payload.CloseHandle();
        }
        catch (Exception failure)
        {
            first = first is null ? failure : new AggregateException(first, failure);
        }
        try
        {
            payload.Dispose();
        }
        catch (Exception failure)
        {
            first = first is null ? failure : new AggregateException(first, failure);
        }
        if (first is not null)
            System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(first).Throw();
        return result;
    }

    internal string Validated(string document, string definition)
    {
        _schema.Validate(document, definition);
        return document;
    }

    internal EngineRunner Runner => _runner;
    internal Core.FfiFacetEngine Engine =>
        !_closed
            ? _engine
                ?? throw new InvalidOperationException("Initialize the standalone engine first.")
            : throw new ObjectDisposedException(nameof(FacetEngineService));
    internal FacetVaultFiles Files => _files;
    internal IReadOnlyDictionary<string, string> UnavailableCapabilities => _unavailable;

    /// <summary>Drain the worker before releasing its native engine.</summary>
    public ValueTask DisposeAsync()
    {
        lock (_disposeGate)
        {
            if (_disposeTask is null || (_disposeTask.IsFaulted && !_closed))
                _disposeTask = DisposeCoreAsync();
            return new(_disposeTask);
        }
    }

    private async Task DisposeCoreAsync()
    {
        Exception? first = null;
        try
        {
            await _runner
                .RunAsync(() =>
                {
                    if (_closed)
                        return true;
                    // Busy must leave the native runtime/callback owners alive for retry.
                    _engine?.CloseRuntime();
                    _closed = true;
                    Exception? cleanup = null;
                    try
                    {
                        _callbacks.Dispose();
                    }
                    catch (Exception error)
                    {
                        cleanup = error;
                    }
                    try
                    {
                        _engine?.Dispose();
                    }
                    catch (Exception error)
                    {
                        cleanup = cleanup is null ? error : new AggregateException(cleanup, error);
                    }
                    _engine = null;
                    if (cleanup is not null)
                        System
                            .Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(cleanup)
                            .Throw();
                    return true;
                })
                .ConfigureAwait(false);
        }
        catch (Exception error)
        {
            first = error;
        }
        if (_closed)
            try
            {
                await _runner.DisposeAsync().ConfigureAwait(false);
            }
            catch (Exception error)
            {
                first = first is null ? error : new AggregateException(first, error);
            }
        if (first is not null)
            System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(first).Throw();
    }
}
