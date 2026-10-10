using System.Diagnostics;
using System.Net.WebSockets;
using System.Runtime.ExceptionServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.VisualStudio.Threading;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Host;

/// <summary>Native socket executor. Rust owns protocol ordering and retry policy.</summary>
internal sealed class FacetSyncSession : System.IAsyncDisposable
{
    private readonly FacetEngineService _engine;
    private readonly string _profile;
    private readonly Core.FfiObsidianSession _session;
    private readonly SemaphoreSlim _serial = new(1, 1);
    private readonly CancellationTokenSource _lifetime = new();
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private readonly HashSet<ulong> _remote = [];
    private readonly HashSet<string> _queued = new(StringComparer.Ordinal);
    private readonly Dictionary<string, (byte[] Nonce, ulong At)> _admissions = new(
        StringComparer.Ordinal
    );
    private readonly Action<bool, string?> _changed;
    private readonly JoinableTaskContext _context = new();
    private readonly List<JoinableTask> _readers = [];
    private IFacetSocket? _socket;
    private readonly Func<IFacetSocket> _socketFactory;
    private readonly Func<byte[]> _uploadNonce;
    private JoinableTask? _ticker;
    private long _socketEpoch;
    private bool _ready;
    private volatile bool _stopped;
    private readonly FacetSchema _schema = FacetSchema.Sync();
    private readonly int _binaryMaximum;
    private readonly int _textMaximum;
    internal bool IsStopped => _stopped;

    /// <summary>Immediate admission/send fence; disposal subsequently awaits protocol and writer drain.</summary>
    internal void RequestStop()
    {
        if (_stopped)
            return;
        _stopped = true;
        _lifetime.Cancel();
    }

    internal Exception? Failure { get; private set; }

    private FacetSyncSession(
        FacetEngineService engine,
        string profile,
        Core.FfiObsidianSession session,
        Action<bool, string?> changed,
        Func<IFacetSocket> socketFactory,
        Core.ObsidianTransportLimits limits,
        Func<byte[]> uploadNonce
    )
    {
        _engine = engine;
        _profile = profile;
        _session = session;
        _changed = changed;
        _socketFactory = socketFactory;
        _uploadNonce = uploadNonce;
        _binaryMaximum = checked((int)limits.BinaryMessageBytes);
        _textMaximum = checked((int)limits.TextMessageBytes);
    }

    internal static async Task<FacetSyncSession> StartAsync(
        FacetEngineService engine,
        FacetProfileRegistration profile,
        ObsidianAccountService account,
        Action<bool, string?> changed,
        CancellationToken cancellationToken,
        Func<IFacetSocket>? socketFactory = null,
        Func<FacetSyncSession, bool>? retain = null,
        Func<byte[]>? uploadNonce = null
    )
    {
        ObsidianVaultChoice vault =
            profile.Vault
            ?? throw new InvalidDataException("The remote vault capability is missing.");
        var credentials = account.SessionCredentials(
            profile.AccountOwner ?? throw new InvalidDataException("The account owner is missing."),
            profile.Id,
            vault.Id
        );
        try
        {
            var schema = FacetSchema.Sync();
            var limits = await engine
                .Runner.RunAsync(
                    Core.TaskNotesCoreMethods.ObsidianTransportLimits,
                    cancellationToken
                )
                .ConfigureAwait(false);
            var session = await engine
                .Runner.RunAsync(
                    () =>
                    {
                        string checkpoint = engine.Engine.LoadCheckpoint(profile.Id) ?? "";
                        if (checkpoint.Length > 0)
                            schema.Validate(checkpoint, "checkpoint");
                        var candidate = new Core.FfiObsidianSession(
                            new Core.ObsidianSessionOptions(
                                vault.Host,
                                credentials.Token,
                                vault.Id,
                                "Facet Windows",
                                vault.EncryptionVersion,
                                vault.Salt,
                                credentials.Key,
                                checkpoint,
                                null
                            )
                        );
                        try
                        {
                            candidate.BindRuntime(engine.Engine, profile.Id);
                        }
                        catch
                        {
                            candidate.Dispose();
                            throw;
                        }
                        return candidate;
                    },
                    cancellationToken
                )
                .ConfigureAwait(false);
            var executor = new FacetSyncSession(
                engine,
                profile.Id,
                session,
                changed,
                socketFactory ?? (() => new FacetSocket()),
                limits,
                uploadNonce ?? (() => RandomNumberGenerator.GetBytes(12))
            );
            try
            {
                if (retain is not null && !retain(executor))
                    throw new OperationCanceledException("The owning profile session was retired.");
                await executor
                    .InvokeAsync(executor.InputAtClock(session.Begin), cancellationToken)
                    .ConfigureAwait(false);
                executor._ticker = executor._context.Factory.RunAsync(executor.TickAsync);
                return executor;
            }
            catch (Exception original)
            {
                try
                {
                    await executor.DisposeAsync().ConfigureAwait(false);
                }
                catch (Exception cleanup)
                {
                    throw new AggregateException(
                        "The Sync session failed to start and cleanup also failed.",
                        original,
                        cleanup
                    );
                }
                throw;
            }
        }
        finally
        {
            CryptographicOperations.ZeroMemory(credentials.Key);
        }
    }

    private ulong Now => checked((ulong)_clock.ElapsedMilliseconds);

    private Func<Core.ObsidianSessionEffect[]> InputAtClock(
        Func<ulong, Core.ObsidianSessionEffect[]> input
    )
    {
        ulong at = Now;
        return () => input(at);
    }

    internal Task WakeAsync(CancellationToken cancellationToken) =>
        InvokeAsync(() => [], cancellationToken);

    private async Task InvokeAsync(
        Func<Core.ObsidianSessionEffect[]> input,
        CancellationToken cancellationToken
    )
    {
        await _serial.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_stopped || _lifetime.IsCancellationRequested)
                return;
            var effects = await NativeAsync(input, cancellationToken).ConfigureAwait(false);
            await EffectsAsync(effects, cancellationToken).ConfigureAwait(false);
            await OutboxAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception error) when (error is WebSocketException or HttpRequestException)
        {
            CloseSocket();
            _ready = false;
            _changed(false, "Obsidian Sync is offline. Local changes remain queued.");
            await EffectsAsync(
                    await _engine
                        .Runner.RunAsync(() => _session.Disconnected(Now), CancellationToken.None)
                        .ConfigureAwait(false),
                    cancellationToken
                )
                .ConfigureAwait(false);
        }
        catch (Exception error)
            when (error
                    is Core.FacetEngineException.Storage
                        or Core.FacetEngineException.Host
                        or Core.ObsidianBoundaryException.Boundary
            )
        {
            Failure = error;
            _stopped = true;
            _ready = false;
            CloseSocket();
            await _engine
                .Runner.RunAsync(() => _session.Cancel(Now), CancellationToken.None)
                .ConfigureAwait(false);
            _changed(
                false,
                error is Core.FacetEngineException.Storage or Core.FacetEngineException.Host
                    ? "Vault storage is unavailable. Restore access, then refresh to resume Sync. Local changes remain retained."
                    : "Obsidian rejected the Sync session. Check vault authorization, then refresh to resume."
            );
        }
        finally
        {
            _serial.Release();
        }
    }

    private async Task EffectsAsync(
        IEnumerable<Core.ObsidianSessionEffect> initial,
        CancellationToken cancellationToken
    )
    {
        Queue<Core.ObsidianSessionEffect> effects = new(initial);
        while (effects.TryDequeue(out var effect))
        {
            cancellationToken.ThrowIfCancellationRequested();
            _lifetime.Token.ThrowIfCancellationRequested();
            if (_stopped)
                return;
            Core.ObsidianSessionEffect[] more = [];
            switch (effect)
            {
                case Core.ObsidianSessionEffect.Connect connect:
                    CloseSocket();
                    var socket = _socketFactory();
                    _socket = socket;
                    long epoch = _socketEpoch;
                    try
                    {
                        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
                            cancellationToken,
                            _lifetime.Token
                        );
                        timeout.CancelAfter(TimeSpan.FromSeconds(30));
                        await socket
                            .ConnectAsync(new Uri(connect.Url), timeout.Token)
                            .ConfigureAwait(false);
                        more = await NativeAsync(InputAtClock(_session.Opened), cancellationToken)
                            .ConfigureAwait(false);
                        _readers.RemoveAll(task => task.Task.IsCompletedSuccessfully);
                        _readers.Add(_context.Factory.RunAsync(() => ReadAsync(socket, epoch)));
                    }
                    catch (Exception error)
                        when (error
                                is WebSocketException
                                    or HttpRequestException
                                    or OperationCanceledException
                            && !_lifetime.IsCancellationRequested
                        )
                    {
                        CloseSocket();
                        _ready = false;
                        _changed(false, "Obsidian Sync is offline. Local changes remain queued.");
                        more = await NativeAsync(
                                InputAtClock(_session.Disconnected),
                                CancellationToken.None
                            )
                            .ConfigureAwait(false);
                    }
                    break;
                case Core.ObsidianSessionEffect.SendText text:
                    await SendAsync(
                            Encoding.UTF8.GetBytes(text.Text),
                            WebSocketMessageType.Text,
                            cancellationToken
                        )
                        .ConfigureAwait(false);
                    break;
                case Core.ObsidianSessionEffect.SendBinary binary:
                    await SendAsync(binary.Bytes, WebSocketMessageType.Binary, cancellationToken)
                        .ConfigureAwait(false);
                    break;
                case Core.ObsidianSessionEffect.Close:
                    CloseSocket();
                    _ready = false;
                    break;
                case Core.ObsidianSessionEffect.PersistCheckpoint checkpoint:
                    _schema.Validate(checkpoint.CheckpointJson, "checkpoint");
                    await NativeAsync(
                            () =>
                            {
                                _engine.Engine.SaveCheckpoint(_profile, checkpoint.CheckpointJson);
                                return true;
                            },
                            cancellationToken
                        )
                        .ConfigureAwait(false);
                    more = await NativeAsync(
                            InputAtClock(at =>
                                _session.CheckpointPersisted(checkpoint.Revision, at)
                            ),
                            cancellationToken
                        )
                        .ConfigureAwait(false);
                    break;
                case Core.ObsidianSessionEffect.PersistCheckpointDelta delta:
                    _schema.Validate(delta.DeltaJson, "checkpointDelta");
                    await NativeAsync(
                            () =>
                            {
                                _engine.Engine.ApplySyncCheckpointDelta(_profile, delta.DeltaJson);
                                return true;
                            },
                            cancellationToken
                        )
                        .ConfigureAwait(false);
                    more = await NativeAsync(
                            InputAtClock(at => _session.CheckpointPersisted(delta.Revision, at)),
                            cancellationToken
                        )
                        .ConfigureAwait(false);
                    break;
                case Core.ObsidianSessionEffect.RemoteChange change:
                    _schema.Validate(change.MetadataJson, "remoteFile");
                    using (JsonDocument document = JsonDocument.Parse(change.MetadataJson))
                    {
                        JsonElement metadata = document.RootElement.Clone();
                        ulong uid = metadata.GetProperty("uid").GetUInt64();
                        if (!metadata.GetProperty("selected").GetBoolean())
                            more = await NativeAsync(
                                    () => _session.CompleteRemote(uid),
                                    cancellationToken
                                )
                                .ConfigureAwait(false);
                        else if (metadata.GetProperty("folder").GetBoolean())
                        {
                            await _engine
                                .Runner.RunAsync(
                                    () =>
                                    {
                                        _engine.Files.ApplyDirectory(
                                            _profile,
                                            metadata.GetProperty("path").GetString()!,
                                            metadata.GetProperty("deleted").GetBoolean()
                                        );
                                        return true;
                                    },
                                    cancellationToken
                                )
                                .ConfigureAwait(false);
                            more = await NativeAsync(
                                    () => _session.CompleteRemote(uid),
                                    cancellationToken
                                )
                                .ConfigureAwait(false);
                        }
                        else
                        {
                            _remote.Add(uid);
                            ulong queuedAt = Now;
                            more = await NativeAsync(
                                    () => _session.QueueDownload(uid, queuedAt),
                                    cancellationToken
                                )
                                .ConfigureAwait(false);
                        }
                    }
                    break;
                case Core.ObsidianSessionEffect.DownloadedPayload download:
                    more = await ApplyRemoteAsync(
                            download.Uid,
                            download.TransferId,
                            cancellationToken
                        )
                        .ConfigureAwait(false);
                    break;
                case Core.ObsidianSessionEffect.Uploaded upload:
                    await NativeAsync(
                            () =>
                            {
                                _engine.Engine.AcknowledgeUpload(
                                    _profile,
                                    upload.OperationId,
                                    upload.ContentHash
                                );
                                return true;
                            },
                            cancellationToken
                        )
                        .ConfigureAwait(false);
                    _queued.Remove(upload.OperationId);
                    _changed(_ready, null);
                    break;
                case Core.ObsidianSessionEffect.Ready:
                    _ready = true;
                    try
                    {
                        await _engine
                            .RefreshAsync(_profile, cancellationToken)
                            .ConfigureAwait(false);
                        _changed(true, null);
                    }
                    catch (Core.FacetEngineException.Configuration error)
                    {
                        _changed(true, error.detail);
                    }
                    break;
                case Core.ObsidianSessionEffect.Failed failure:
                    if (failure.OperationId is not null)
                        _queued.Remove(failure.OperationId);
                    if (!failure.Retryable)
                    {
                        _stopped = true;
                        _ready = false;
                        CloseSocket();
                    }
                    _changed(
                        false,
                        failure.Code switch
                        {
                            "authentication" => "Authorize this vault with Obsidian again.",
                            "queue_full" =>
                                "Sync is waiting for earlier transfers. Local changes remain queued.",
                            _ =>
                                "Obsidian Sync could not complete a transfer. Local changes remain queued.",
                        }
                    );
                    break;
                case Core.ObsidianSessionEffect.Cancelled cancelled:
                    _queued.Remove(cancelled.OperationId);
                    break;
                default:
                    throw new InvalidDataException("Unknown Sync effect.");
            }
            foreach (var next in more)
                effects.Enqueue(next);
        }
    }

    private async Task<Core.ObsidianSessionEffect[]> ApplyRemoteAsync(
        ulong uid,
        string transferId,
        CancellationToken cancellationToken
    )
    {
        if (!_remote.Contains(uid))
            throw new InvalidDataException("The download has no owning remote notice.");
        await NativeAsync(
                () =>
                {
                    _session.ApplyDownload(transferId);
                    return true;
                },
                cancellationToken
            )
            .ConfigureAwait(false);
        var effects = await NativeAsync(() => _session.CompleteRemote(uid), cancellationToken)
            .ConfigureAwait(false);
        _remote.Remove(uid);
        _changed(_ready, null);
        return effects;
    }

    private async Task OutboxAsync(CancellationToken cancellationToken)
    {
        if (!_ready || _stopped)
            return;
        string json = await _engine
            .Runner.RunAsync(
                () => _engine.Validated(_engine.Engine.PendingUploadsJson(_profile), "uploads"),
                cancellationToken
            )
            .ConfigureAwait(false);
        using var document = JsonDocument.Parse(json);
        foreach (var upload in document.RootElement.GetProperty("uploads").EnumerateArray())
        {
            string id = upload.GetProperty("mutationId").GetString()!;
            if (_queued.Contains(id))
                continue;
            if (!_admissions.TryGetValue(id, out var admission))
            {
                byte[] nonce = _uploadNonce();
                if (nonce.Length != 12)
                    throw new InvalidDataException(
                        "An upload admission requires an exact 12-byte nonce."
                    );
                admission = (nonce, Now);
                _admissions.Add(id, admission);
            }
            Core.ObsidianSessionEffect[] effects;
            try
            {
                effects = await NativeAsync(
                        () => _session.QueueDurableUpload(id, admission.Nonce, admission.At),
                        cancellationToken
                    )
                    .ConfigureAwait(false);
            }
            catch (Core.ObsidianBoundaryException.Boundary failure)
                when (failure.code == "queue_full")
            {
                return;
            }
            _queued.Add(id);
            _admissions.Remove(id);
            await EffectsAsync(effects, cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task SendAsync(
        byte[] bytes,
        WebSocketMessageType type,
        CancellationToken cancellationToken
    )
    {
        var socket = _socket ?? throw new WebSocketException("The socket is unavailable.");
        await socket.SendAsync(bytes.AsMemory(), type, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Replay only Busy admission; every other failure retains its actual type.</summary>
    private async Task<T> NativeAsync<T>(Func<T> operation, CancellationToken cancellationToken)
    {
        return await FacetBusyReplay
            .RunAsync(
                () => _engine.Runner.RunAsync(operation, cancellationToken),
                () => !_stopped && !_lifetime.IsCancellationRequested,
                cancellationToken
            )
            .ConfigureAwait(false);
    }

    private async Task ReadAsync(IFacetSocket socket, long epoch)
    {
        try
        {
            while (!_lifetime.IsCancellationRequested && epoch == Volatile.Read(ref _socketEpoch))
            {
                var frame = await FacetSocketFrames
                    .ReadAsync(socket, _binaryMaximum, _textMaximum, _lifetime.Token)
                    .ConfigureAwait(false);
                byte[] bytes = frame.Bytes;
                string? text =
                    frame.Type == WebSocketMessageType.Text
                        ? FacetSocketFrames.DecodeText(bytes)
                        : null;
                ulong receivedAt = Now;
                await InvokeAsync(
                        () =>
                            epoch != _socketEpoch ? []
                            : frame.Type == WebSocketMessageType.Text
                                ? _session.ReceiveText(text!, receivedAt)
                            : _session.ReceiveBinary(bytes, receivedAt),
                        _lifetime.Token
                    )
                    .ConfigureAwait(false);
            }
        }
        catch (FacetFrameException)
        {
            if (!_lifetime.IsCancellationRequested)
            {
                // The lifetime may cancel between the check and acquiring ownership.
                // Drain this reader normally; disposal awaits it before releasing the session.
                await _serial.WaitAsync(CancellationToken.None).ConfigureAwait(false);
                try
                {
                    if (!_lifetime.IsCancellationRequested && epoch == _socketEpoch)
                    {
                        _stopped = true;
                        _ready = false;
                        CloseSocket();
                        await _engine
                            .Runner.RunAsync(() => _session.Cancel(Now), CancellationToken.None)
                            .ConfigureAwait(false);
                        _changed(
                            false,
                            "Obsidian Sync sent an invalid or oversized message. Refresh to reconnect; local changes remain retained."
                        );
                    }
                }
                finally
                {
                    _serial.Release();
                }
            }
        }
        catch (Exception error)
            when (error
                    is WebSocketException
                        or IOException
                        or OperationCanceledException
                        or ObjectDisposedException
            )
        {
            if (!_lifetime.IsCancellationRequested)
                await InvokeAsync(
                        InputAtClock(at => epoch == _socketEpoch ? _session.Disconnected(at) : []),
                        CancellationToken.None
                    )
                    .ConfigureAwait(false);
        }
    }

    private async Task TickAsync()
    {
        using PeriodicTimer timer = new(TimeSpan.FromSeconds(1));
        try
        {
            while (await timer.WaitForNextTickAsync(_lifetime.Token).ConfigureAwait(false))
                await InvokeAsync(InputAtClock(_session.Tick), _lifetime.Token)
                    .ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested) { }
    }

    private void CloseSocket()
    {
        Interlocked.Increment(ref _socketEpoch);
        var socket = Interlocked.Exchange(ref _socket, null);
        if (socket is null)
            return;
        try
        {
            socket.Abort();
        }
        catch (Exception original)
        {
            try
            {
                socket.Dispose();
            }
            catch (Exception cleanup)
            {
                throw new AggregateException(
                    "Socket abort and disposal both failed.",
                    original,
                    cleanup
                );
            }
            throw;
        }
        socket.Dispose();
    }

    public async ValueTask DisposeAsync()
    {
        ExceptionDispatchInfo? failure = null;
        try
        {
            await _lifetime.CancelAsync().ConfigureAwait(false);
        }
        catch (Exception error)
        {
            failure = ExceptionDispatchInfo.Capture(error);
        }
        try
        {
            CloseSocket();
        }
        catch (Exception error)
        {
            failure ??= ExceptionDispatchInfo.Capture(error);
        }
        try
        {
            if (_ticker is not null)
                try
                {
                    await _ticker;
                }
                catch (Exception error)
                {
                    failure ??= ExceptionDispatchInfo.Capture(error);
                }
            foreach (var reader in _readers)
                try
                {
                    await reader;
                }
                catch (Exception error)
                {
                    failure ??= ExceptionDispatchInfo.Capture(error);
                }
            await _serial.WaitAsync().ConfigureAwait(false);
            try
            {
                await _engine
                    .Runner.RunAsync(() =>
                    {
                        try
                        {
                            try
                            {
                                _session.Cancel(Now);
                            }
                            finally
                            {
                                _session.UnbindRuntime(Now);
                            }
                        }
                        finally
                        {
                            _session.Dispose();
                        }
                        return true;
                    })
                    .ConfigureAwait(false);
            }
            catch (Exception error)
            {
                failure ??= ExceptionDispatchInfo.Capture(error);
            }
            finally
            {
                _serial.Release();
            }
        }
        finally
        {
            _serial.Dispose();
            _lifetime.Dispose();
            _context.Dispose();
        }
        failure?.Throw();
    }
}
