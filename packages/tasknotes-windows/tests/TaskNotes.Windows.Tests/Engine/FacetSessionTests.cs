using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Channels;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>Native session effects executed through the actual host transport and SQLite boundary.</summary>
[TestClass]
public sealed class FacetSessionTests
{
    /// <summary>A reserved authenticated download backpressures the original upload admission without terminating either transfer.</summary>
    [TestMethod]
    public async Task ReservedDownloadRetainsUploadNonceUntilAdmissionAndAcknowledgement()
    {
        using var capture = await CapturesAsync(TestContext.CancellationToken);
        var transcript = capture.RootElement.GetProperty("transcript").GetProperty("cases")[0];
        using SessionFixture fixture = CapturedFixture(transcript);
        await using var engine = await fixture.OpenEngineAsync(TestContext.CancellationToken);
        await using ObsidianAccountService account = new(CapturedSecrets(transcript));
        using TranscriptSocket socket = new() { AcknowledgeUploads = true };
        int nonces = 0;
        await using var session = await FacetSyncSession.StartAsync(
            engine,
            fixture.Profile,
            account,
            (_, _) => { },
            TestContext.CancellationToken,
            () => socket,
            uploadNonce: () =>
            {
                Interlocked.Increment(ref nonces);
                return new byte[12];
            }
        );
        await socket.AddAsync("{\"res\":\"ok\"}", TestContext.CancellationToken);
        await socket.AddAsync("{\"op\":\"ready\",\"version\":5}", TestContext.CancellationToken);
        var notification = JsonNode
            .Parse(transcript.GetProperty("frames")[1].GetProperty("text").GetRawText())!
            .AsObject();
        notification["uid"] = 6;
        notification["relatedpath"] = null;
        await socket.AddAsync(notification.ToJsonString(), TestContext.CancellationToken);
        await socket.Pull.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.CancellationToken);
        await engine.ExecuteAsync(
            "p",
            """
            {"schemaVersion":1,"mutationId":"during-pull","at":"2026-10-03T12:00:00Z","command":{"kind":"create","path":"Tasks/outgoing.md","properties":{"title":"Outgoing","status":"open","priority":"normal","tags":["task"]},"body":"Kept while the download owns capacity"}}
            """,
            TestContext.CancellationToken
        );
        await session.WakeAsync(TestContext.CancellationToken);
        await session.WakeAsync(TestContext.CancellationToken);
        Assert.AreEqual(1, Volatile.Read(ref nonces));
        Assert.IsFalse(socket.BinaryUpload.Task.IsCompleted);
        Assert.IsFalse(session.IsStopped);
        using (
            var pending = JsonDocument.Parse(
                await engine.Runner.RunAsync(
                    () => engine.Engine.PendingUploadsJson("p"),
                    TestContext.CancellationToken
                )
            )
        )
            Assert.HasCount(
                1,
                pending.RootElement.GetProperty("uploads").EnumerateArray().ToArray()
            );
        await socket.AddAsync("{\"size\":36,\"pieces\":1}", TestContext.CancellationToken);
        await socket.AddAsync(
            transcript
                .GetProperty("frames")[2]
                .GetProperty("binary")
                .EnumerateArray()
                .Select(n => n.GetByte())
                .ToArray(),
            TestContext.CancellationToken,
            WebSocketMessageType.Binary
        );
        await socket.BinaryUpload.Task.WaitAsync(
            TimeSpan.FromSeconds(5),
            TestContext.CancellationToken
        );
        await WaitForAsync(async () =>
        {
            using var checkpoint = JsonDocument.Parse(
                (
                    await engine.Runner.RunAsync(
                        () => engine.Engine.LoadCheckpoint("p"),
                        TestContext.CancellationToken
                    )
                )!
            );
            using var uploads = JsonDocument.Parse(
                await engine.Runner.RunAsync(
                    () => engine.Engine.PendingUploadsJson("p"),
                    TestContext.CancellationToken
                )
            );
            return checkpoint.RootElement.GetProperty("cursor").GetUInt64() == 6
                && !checkpoint.RootElement.GetProperty("pending").EnumerateObject().Any()
                && uploads.RootElement.GetProperty("uploads").GetArrayLength() == 0;
        });
        Assert.AreEqual(1, Volatile.Read(ref nonces));
        Assert.IsFalse(session.IsStopped);
        string remotePath = transcript.GetProperty("notices")[0].GetProperty("path").GetString()!;
        CollectionAssert.AreEqual(
            transcript
                .GetProperty("pulledBytes")
                .EnumerateArray()
                .Select(n => n.GetByte())
                .ToArray(),
            await File.ReadAllBytesAsync(
                Path.Combine(fixture.Profile.RootPath, remotePath),
                TestContext.CancellationToken
            )
        );
        StringAssert.Contains(
            await File.ReadAllTextAsync(
                Path.Combine(fixture.Profile.RootPath, "Tasks/outgoing.md"),
                TestContext.CancellationToken
            ),
            "Kept while the download owns capacity",
            StringComparison.Ordinal
        );
    }

    /// <summary>Encrypted directory notifications and tombstones execute before durable cursor acknowledgement.</summary>
    [TestMethod]
    public async Task CapturedDirectoryAndDeletionNotificationsCommitDurably()
    {
        using var capture = await CapturesAsync(TestContext.CancellationToken);
        var transcript = capture.RootElement.GetProperty("transcript").GetProperty("cases")[0];
        using SessionFixture fixture = CapturedFixture(transcript);
        await using var engine = await fixture.OpenEngineAsync(TestContext.CancellationToken);
        await using ObsidianAccountService account = new(CapturedSecrets(transcript));
        using TranscriptSocket socket = new();
        await using var session = await FacetSyncSession.StartAsync(
            engine,
            fixture.Profile,
            account,
            (_, _) => { },
            TestContext.CancellationToken,
            () => socket
        );
        await socket.AddAsync("{\"res\":\"ok\"}", TestContext.CancellationToken);
        await socket.AddAsync("{\"op\":\"ready\",\"version\":5}", TestContext.CancellationToken);
        var original = JsonNode
            .Parse(transcript.GetProperty("frames")[1].GetProperty("text").GetRawText())!
            .AsObject();
        string path = transcript.GetProperty("notices")[0].GetProperty("path").GetString()!;
        var folder = original.DeepClone().AsObject();
        folder["uid"] = 6;
        folder["folder"] = true;
        folder["deleted"] = false;
        folder["relatedpath"] = null;
        await socket.AddAsync(folder.ToJsonString(), TestContext.CancellationToken);
        await WaitForAsync(() =>
            Task.FromResult(Directory.Exists(Path.Combine(fixture.Profile.RootPath, path)))
        );
        folder["uid"] = 7;
        folder["deleted"] = true;
        await socket.AddAsync(folder.ToJsonString(), TestContext.CancellationToken);
        await WaitForAsync(() =>
            Task.FromResult(!Directory.Exists(Path.Combine(fixture.Profile.RootPath, path)))
        );
        byte[] baseBytes = transcript
            .GetProperty("pulledBytes")
            .EnumerateArray()
            .Select(n => n.GetByte())
            .ToArray();
        var pulled = original.DeepClone().AsObject();
        pulled["uid"] = 8;
        pulled["folder"] = false;
        pulled["deleted"] = false;
        pulled["relatedpath"] = null;
        await socket.AddAsync(pulled.ToJsonString(), TestContext.CancellationToken);
        await socket.AddAsync("{\"size\":36,\"pieces\":1}", TestContext.CancellationToken);
        await socket.AddAsync(
            transcript
                .GetProperty("frames")[2]
                .GetProperty("binary")
                .EnumerateArray()
                .Select(value => value.GetByte())
                .ToArray(),
            TestContext.CancellationToken,
            WebSocketMessageType.Binary
        );
        await WaitForAsync(() =>
            Task.FromResult(File.Exists(Path.Combine(fixture.Profile.RootPath, path)))
        );
        CollectionAssert.AreEqual(
            baseBytes,
            await File.ReadAllBytesAsync(
                Path.Combine(fixture.Profile.RootPath, path),
                TestContext.CancellationToken
            )
        );
        var deleted = original.DeepClone().AsObject();
        deleted["uid"] = 9;
        deleted["folder"] = false;
        deleted["deleted"] = true;
        deleted["hash"] = "";
        deleted["size"] = 0;
        deleted["relatedpath"] = null;
        await socket.AddAsync(deleted.ToJsonString(), TestContext.CancellationToken);
        await socket.AddAsync("{\"deleted\":true}", TestContext.CancellationToken);
        await WaitForAsync(async () =>
        {
            if (session.IsStopped)
                throw new InvalidOperationException(
                    "The captured tombstone session stopped.",
                    session.Failure
                );
            string? checkpoint = await engine.Runner.RunAsync(
                () => engine.Engine.LoadCheckpoint("p"),
                TestContext.CancellationToken
            );
            if (checkpoint is null)
                return false;
            using var state = JsonDocument.Parse(checkpoint);
            return state.RootElement.GetProperty("cursor").GetUInt64() == 9
                && !state.RootElement.GetProperty("pending").EnumerateObject().Any();
        });
        Assert.IsFalse(File.Exists(Path.Combine(fixture.Profile.RootPath, path)));
        Assert.IsFalse(session.IsStopped);
        await File.WriteAllTextAsync(
            Path.Combine(fixture.Profile.RootPath, path),
            "A new local version must survive remote deletion",
            TestContext.CancellationToken
        );
        await engine.RefreshAsync("p", TestContext.CancellationToken);
        deleted["uid"] = 10;
        await socket.AddAsync(deleted.ToJsonString(), TestContext.CancellationToken);
        await socket.AddAsync("{\"deleted\":true}", TestContext.CancellationToken);
        await WaitForAsync(async () =>
        {
            string? checkpoint = await engine.Runner.RunAsync(
                () => engine.Engine.LoadCheckpoint("p"),
                TestContext.CancellationToken
            );
            if (checkpoint is null)
                return false;
            using var state = JsonDocument.Parse(checkpoint);
            return state.RootElement.GetProperty("cursor").GetUInt64() == 10
                && !state.RootElement.GetProperty("pending").EnumerateObject().Any();
        });
        Assert.AreEqual(
            "A new local version must survive remote deletion",
            await File.ReadAllTextAsync(
                Path.Combine(fixture.Profile.RootPath, path),
                TestContext.CancellationToken
            )
        );
    }

    /// <summary>A revoked capability stops refresh effects without discarding the committed SQLite index.</summary>
    [TestMethod]
    public async Task ReadyFilesystemFailureStopsSessionAndRetainsCachedSnapshot()
    {
        using SessionFixture fixture = new();
        string configurationDirectory = Path.Combine(
            fixture.Profile.RootPath,
            ".obsidian",
            "plugins",
            "tasknotes"
        );
        Directory.CreateDirectory(configurationDirectory);
        await File.WriteAllTextAsync(
            Path.Combine(configurationDirectory, "data.json"),
            "{\"storeTitleInFilename\":false}",
            TestContext.CancellationToken
        );
        await File.WriteAllTextAsync(
            Path.Combine(fixture.Profile.RootPath, "cached.md"),
            "---\ntitle: Cached\nstatus: open\npriority: normal\ntags: [task]\n---\n",
            TestContext.CancellationToken
        );
        await using var engine = await fixture.OpenEngineAsync(TestContext.CancellationToken);
        await using ObsidianAccountService account = new(new SessionSecrets("owner"));
        using TranscriptSocket socket = new();
        TaskCompletionSource failed = new(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var session = await FacetSyncSession.StartAsync(
            engine,
            fixture.Profile,
            account,
            (_, error) =>
            {
                if (error is not null)
                    failed.TrySetResult();
            },
            TestContext.CancellationToken,
            () => socket
        );
        string moved = fixture.Profile.RootPath + "-revoked";
        Directory.Move(fixture.Profile.RootPath, moved);
        try
        {
            await socket.AddAsync("{\"res\":\"ok\"}", TestContext.CancellationToken);
            await socket.AddAsync(
                "{\"op\":\"ready\",\"version\":5}",
                TestContext.CancellationToken
            );
            await failed.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.CancellationToken);
            Assert.IsTrue(session.IsStopped);
            Assert.IsTrue(socket.Aborted);
            using var snapshot = JsonDocument.Parse(
                await engine.SnapshotAsync(
                    "p",
                    "{\"scope\":\"all\"}",
                    TestContext.CancellationToken
                )
            );
            Assert.AreEqual(
                "Cached",
                snapshot.RootElement.GetProperty("tasks")[0].GetProperty("title").GetString()
            );
            int sends = socket.SendCount;
            await session.WakeAsync(TestContext.CancellationToken);
            Assert.AreEqual(sends, socket.SendCount);
        }
        finally
        {
            Directory.Move(moved, fixture.Profile.RootPath);
        }
    }

    /// <summary>A failing external socket cleanup cannot leak session/ticker ownership.</summary>
    [TestMethod]
    public async Task SocketDisposalFailureStillDrainsSessionAndPreventsSends()
    {
        using SessionFixture fixture = new();
        await using var engine = await fixture.OpenEngineAsync(TestContext.CancellationToken);
        await using ObsidianAccountService account = new(new SessionSecrets("owner"));
        TranscriptSocket socket = new() { FailDispose = true };
        var session = await FacetSyncSession.StartAsync(
            engine,
            fixture.Profile,
            account,
            (_, _) => { },
            TestContext.CancellationToken,
            () => socket
        );
        var failure = await Assert.ThrowsExactlyAsync<InvalidOperationException>(() =>
            session.DisposeAsync().AsTask()
        );
        Assert.AreEqual("Synthetic disposal failure.", failure.Message);
        Assert.IsTrue(socket.Disposed);
        Assert.IsTrue(socket.Aborted);
        int sends = socket.SendCount;
        await Task.Delay(20, TestContext.CancellationToken);
        Assert.AreEqual(sends, socket.SendCount);
    }

    /// <summary>Native upload receipts consume the durable outbox using immutable creation timestamps.</summary>
    [TestMethod]
    public async Task BinaryUploadAcknowledgementConsumesExactDurableReceipt()
    {
        using SessionFixture fixture = new();
        await using var engine = await fixture.OpenEngineAsync(TestContext.CancellationToken);
        await engine.ExecuteAsync(
            "p",
            """
            {"schemaVersion":1,"mutationId":"upload-create","at":"2026-10-03T12:00:00Z","command":{"kind":"create","path":"Tasks/upload.md","properties":{"title":"Uploaded","status":"open","priority":"normal","tags":["task"]},"body":"Exact preserved body"}}
            """,
            TestContext.CancellationToken
        );
        byte[] before = await File.ReadAllBytesAsync(
            Path.Combine(fixture.Profile.RootPath, "Tasks/upload.md"),
            TestContext.CancellationToken
        );
        await using ObsidianAccountService account = new(new SessionSecrets("owner"));
        using TranscriptSocket socket = new() { AcknowledgeUploads = true };
        await using var session = await FacetSyncSession.StartAsync(
            engine,
            fixture.Profile,
            account,
            (_, _) => { },
            TestContext.CancellationToken,
            () => socket
        );
        await socket.AddAsync("{\"res\":\"ok\"}", TestContext.CancellationToken);
        await socket.AddAsync("{\"op\":\"ready\",\"version\":5}", TestContext.CancellationToken);
        await socket.BinaryUpload.Task.WaitAsync(
            TimeSpan.FromSeconds(5),
            TestContext.CancellationToken
        );
        await WaitForAsync(async () =>
        {
            string uploads = await engine.Runner.RunAsync(
                () => engine.Engine.PendingUploadsJson("p"),
                TestContext.CancellationToken
            );
            using var pending = JsonDocument.Parse(uploads);
            return pending.RootElement.GetProperty("uploads").GetArrayLength() == 0;
        });
        Assert.IsTrue(socket.UploadBytes > before.Length);
        long originalTimestamp = DateTimeOffset
            .Parse("2026-10-03T12:00:00Z", System.Globalization.CultureInfo.InvariantCulture)
            .ToUnixTimeMilliseconds();
        Assert.AreEqual(originalTimestamp, socket.CreationTime);
        Assert.AreEqual(originalTimestamp, socket.ModificationTime);
        CollectionAssert.AreEqual(
            before,
            await File.ReadAllBytesAsync(
                Path.Combine(fixture.Profile.RootPath, "Tasks/upload.md"),
                TestContext.CancellationToken
            )
        );
        Assert.IsFalse(session.IsStopped);
    }

    /// <summary>Independent official-client ciphertext downloads through the production executor.</summary>
    [TestMethod]
    public async Task CapturedRemotePayloadCommitsBeforeCheckpointAcknowledgement()
    {
        using var capture = await CapturesAsync(TestContext.CancellationToken);
        foreach (
            var transcript in capture
                .RootElement.GetProperty("transcript")
                .GetProperty("cases")
                .EnumerateArray()
        )
        {
            byte version = transcript.GetProperty("version").GetByte();
            using SessionFixture fixture = new(
                version,
                transcript.GetProperty("salt").GetString()!
            );
            await using var engine = await fixture.OpenEngineAsync(TestContext.CancellationToken);
            await using ObsidianAccountService account = new(
                new SessionSecrets(
                    "owner",
                    transcript
                        .GetProperty("keyBytes")
                        .EnumerateArray()
                        .Select(n => n.GetByte())
                        .ToArray()
                )
            );
            using TranscriptSocket socket = new();
            TaskCompletionSource ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
            await using var session = await FacetSyncSession.StartAsync(
                engine,
                fixture.Profile,
                account,
                (connected, _) =>
                {
                    if (connected)
                        ready.TrySetResult();
                },
                TestContext.CancellationToken,
                () => socket
            );
            await socket.AddAsync("{\"res\":\"ok\"}", TestContext.CancellationToken);
            await socket.AddAsync(
                "{\"op\":\"ready\",\"version\":5}",
                TestContext.CancellationToken
            );
            await ready.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.CancellationToken);
            var notification = JsonNode
                .Parse(transcript.GetProperty("frames")[1].GetProperty("text").GetRawText())!
                .AsObject();
            notification["uid"] = 6;
            notification["relatedpath"] = null;
            await socket.AddAsync(notification.ToJsonString(), TestContext.CancellationToken);
            await socket.Pull.Task.WaitAsync(
                TimeSpan.FromSeconds(5),
                TestContext.CancellationToken
            );
            await socket.AddAsync("{\"size\":36,\"pieces\":1}", TestContext.CancellationToken);
            await socket.AddAsync(
                transcript
                    .GetProperty("frames")[2]
                    .GetProperty("binary")
                    .EnumerateArray()
                    .Select(n => n.GetByte())
                    .ToArray(),
                TestContext.CancellationToken,
                WebSocketMessageType.Binary
            );
            string path = transcript.GetProperty("notices")[0].GetProperty("path").GetString()!;
            byte[] expected = transcript
                .GetProperty("pulledBytes")
                .EnumerateArray()
                .Select(n => n.GetByte())
                .ToArray();
            await WaitForAsync(async () =>
            {
                string? checkpoint = await engine.Runner.RunAsync(
                    () => engine.Engine.LoadCheckpoint("p"),
                    TestContext.CancellationToken
                );
                if (checkpoint is null)
                    return false;
                using var state = JsonDocument.Parse(checkpoint);
                return !state.RootElement.GetProperty("pending").EnumerateObject().Any()
                    && File.Exists(Path.Combine(fixture.Profile.RootPath, path));
            });
            CollectionAssert.AreEqual(
                expected,
                await File.ReadAllBytesAsync(
                    Path.Combine(fixture.Profile.RootPath, path),
                    TestContext.CancellationToken
                )
            );
            Assert.IsFalse(session.IsStopped);
        }
    }

    private async Task WaitForAsync(Func<Task<bool>> predicate)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(
            TestContext.CancellationToken
        );
        deadline.CancelAfter(TimeSpan.FromSeconds(5));
        while (!await predicate())
            await Task.Delay(10, deadline.Token);
    }

    /// <summary>Authorization mismatch prevents even opening a socket with old credentials.</summary>
    [TestMethod]
    public async Task AccountOwnerMismatchCannotSendOrConnect()
    {
        using SessionFixture fixture = new();
        await using var engine = await fixture.OpenEngineAsync(TestContext.CancellationToken);
        await using ObsidianAccountService account = new(new SessionSecrets("another-owner"));
        int factories = 0;
        _ = await Assert.ThrowsExactlyAsync<FacetAuthorizationRequiredException>(() =>
            FacetSyncSession.StartAsync(
                engine,
                fixture.Profile,
                account,
                (_, _) => { },
                TestContext.CancellationToken,
                () =>
                {
                    factories++;
                    return new TranscriptSocket();
                }
            )
        );
        Assert.AreEqual(0, factories);
    }

    /// <summary>Protocol and framing failures stop transport, preserve the cached vault and drain ownership.</summary>
    [TestMethod]
    public async Task ReadyMalformedFrameAndDisposalRetainOriginalState()
    {
        foreach (
            byte[] malformed in new[] { new byte[] { 0xff }, Encoding.UTF8.GetBytes("not-json") }
        )
        {
            using SessionFixture fixture = new();
            await using var engine = await fixture.OpenEngineAsync(TestContext.CancellationToken);
            await using ObsidianAccountService account = new(new SessionSecrets("owner"));
            using TranscriptSocket socket = new();
            TaskCompletionSource ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
            TaskCompletionSource stopped = new(TaskCreationOptions.RunContinuationsAsynchronously);
            await using (
                var session = await FacetSyncSession.StartAsync(
                    engine,
                    fixture.Profile,
                    account,
                    (connected, error) =>
                    {
                        if (connected)
                            ready.TrySetResult();
                        if (error is not null)
                            stopped.TrySetResult();
                    },
                    TestContext.CancellationToken,
                    () => socket
                )
            )
            {
                await socket.AddAsync("{\"res\":\"ok\"}", TestContext.CancellationToken);
                await socket.AddAsync(
                    "{\"op\":\"ready\",\"version\":7}",
                    TestContext.CancellationToken
                );
                await ready.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.CancellationToken);
                string? checkpoint = await engine.Runner.RunAsync(
                    () => engine.Engine.LoadCheckpoint("p"),
                    TestContext.CancellationToken
                );
                Assert.IsNotNull(checkpoint);
                FacetSchema.Sync().Validate(checkpoint, "checkpoint");
                await socket.AddAsync(malformed, TestContext.CancellationToken);
                await stopped.Task.WaitAsync(
                    TimeSpan.FromSeconds(5),
                    TestContext.CancellationToken
                );
                Assert.IsTrue(session.IsStopped);
                int sends = socket.SendCount;
                await session.WakeAsync(TestContext.CancellationToken);
                Assert.AreEqual(sends, socket.SendCount);
                Assert.IsTrue(socket.Aborted);
            }
            Assert.IsTrue(socket.Disposed);
        }
    }

    /// <summary>A send failure is visible and disposal cancels every reader before credentials may change.</summary>
    [TestMethod]
    public async Task SendFailureAndCancellationReleaseTheOldSocket()
    {
        using SessionFixture fixture = new();
        await using var engine = await fixture.OpenEngineAsync(TestContext.CancellationToken);
        await using ObsidianAccountService account = new(new SessionSecrets("owner"));
        using TranscriptSocket socket = new() { FailSend = true };
        string? failure = null;
        var session = await FacetSyncSession.StartAsync(
            engine,
            fixture.Profile,
            account,
            (_, error) => failure = error,
            TestContext.CancellationToken,
            () => socket
        );
        Assert.IsNotNull(failure);
        Assert.IsTrue(socket.Aborted);
        await session.DisposeAsync();
        int sends = socket.SendCount;
        Assert.IsTrue(socket.Disposed);
        Assert.AreEqual(sends, socket.SendCount);
    }

    private static Task<JsonDocument> CapturesAsync(CancellationToken cancellationToken) =>
        JsonDocument.ParseAsync(
            typeof(FacetSessionTests).Assembly.GetManifestResourceStream(
                "ObsidianProtocolCapture.json"
            )!,
            cancellationToken: cancellationToken
        );

    private static SessionFixture CapturedFixture(JsonElement transcript) =>
        new(
            transcript.GetProperty("version").GetByte(),
            transcript.GetProperty("salt").GetString()!
        );

    private static SessionSecrets CapturedSecrets(JsonElement transcript) =>
        new(
            "owner",
            transcript.GetProperty("keyBytes").EnumerateArray().Select(n => n.GetByte()).ToArray()
        );

    private sealed class TranscriptSocket : IFacetSocket
    {
        private readonly Channel<(byte[] Bytes, WebSocketMessageType Type)> _frames =
            Channel.CreateUnbounded<(byte[], WebSocketMessageType)>();
        private readonly CancellationTokenSource _aborted = new();
        private byte[]? _current;
        private WebSocketMessageType _type;
        private int _position;
        internal bool FailSend { get; init; }
        internal bool FailDispose { get; init; }
        internal int SendCount { get; private set; }
        internal bool Aborted { get; private set; }
        internal bool Disposed { get; private set; }
        internal bool AcknowledgeUploads { get; init; }
        internal long? CreationTime { get; private set; }
        internal long? ModificationTime { get; private set; }
        internal int UploadBytes { get; private set; }
        internal TaskCompletionSource BinaryUpload { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal TaskCompletionSource Pull { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        internal ValueTask AddAsync(string text, CancellationToken cancellationToken) =>
            AddAsync(Encoding.UTF8.GetBytes(text), cancellationToken);

        internal ValueTask AddAsync(
            byte[] bytes,
            CancellationToken cancellationToken,
            WebSocketMessageType type = WebSocketMessageType.Text
        ) => _frames.Writer.WriteAsync((bytes, type), cancellationToken);

        public Task ConnectAsync(Uri uri, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.CompletedTask;
        }

        public ValueTask SendAsync(
            ReadOnlyMemory<byte> bytes,
            WebSocketMessageType type,
            CancellationToken cancellationToken
        )
        {
            cancellationToken.ThrowIfCancellationRequested();
            ObjectDisposedException.ThrowIf(Aborted || Disposed, this);
            SendCount++;
            if (type == WebSocketMessageType.Text)
            {
                using var frame = JsonDocument.Parse(bytes);
                if (
                    frame.RootElement.TryGetProperty("op", out var operation)
                    && operation.GetString() == "pull"
                )
                    Pull.TrySetResult();
                if (
                    AcknowledgeUploads
                    && operation.ValueKind == JsonValueKind.String
                    && operation.GetString() == "push"
                )
                {
                    CreationTime = frame.RootElement.GetProperty("ctime").GetInt64();
                    ModificationTime = frame.RootElement.GetProperty("mtime").GetInt64();
                    _frames.Writer.TryWrite(
                        ("{\"res\":\"upload\"}"u8.ToArray(), WebSocketMessageType.Text)
                    );
                }
            }
            else if (AcknowledgeUploads && type == WebSocketMessageType.Binary)
            {
                UploadBytes += bytes.Length;
                _frames.Writer.TryWrite(
                    ("{\"res\":\"ok\"}"u8.ToArray(), WebSocketMessageType.Text)
                );
                BinaryUpload.TrySetResult();
            }
            return FailSend
                ? ValueTask.FromException(new WebSocketException("Synthetic send failure."))
                : ValueTask.CompletedTask;
        }

        public async ValueTask<ValueWebSocketReceiveResult> ReceiveAsync(
            Memory<byte> buffer,
            CancellationToken cancellationToken
        )
        {
            using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(
                cancellationToken,
                _aborted.Token
            );
            if (_current is null)
            {
                var frame = await _frames.Reader.ReadAsync(lifetime.Token);
                _current = frame.Bytes;
                _type = frame.Type;
            }
            int count = Math.Min(buffer.Length, _current.Length - _position);
            _current.AsMemory(_position, count).CopyTo(buffer);
            _position += count;
            bool end = _position == _current.Length;
            if (end)
            {
                _current = null;
                _position = 0;
            }
            return new ValueWebSocketReceiveResult(count, _type, end);
        }

        public void Abort()
        {
            Aborted = true;
            _aborted.Cancel();
        }

        public void Dispose()
        {
            if (Disposed)
                return;
            Abort();
            Disposed = true;
            _aborted.Dispose();
            if (FailDispose)
                throw new InvalidOperationException("Synthetic disposal failure.");
        }
    }

    private sealed class SessionSecrets(string owner, byte[]? key = null) : IFacetSecretStore
    {
        public string? Read(string identity) =>
            identity switch
            {
                "obsidian/account-owner" => owner,
                "obsidian/account-token" => "synthetic-session-token",
                "obsidian/vault-key/owner/p/fixture-vault" => Convert.ToBase64String(
                    key ?? new byte[32]
                ),
                _ => null,
            };

        public void Save(string identity, string value) =>
            throw new InvalidOperationException("The session fixture does not authorize accounts.");

        public void Remove(string identity) { }
    }

    private sealed class SessionFixture : IDisposable
    {
        private readonly TemporaryDirectory _temporary = new();
        private readonly string _physical;
        internal FacetProfileRegistration Profile { get; }

        internal SessionFixture(byte encryptionVersion = 3, string salt = "public-salt")
        {
            _physical =
                OperatingSystem.IsMacOS()
                && _temporary.Path.StartsWith("/var/", StringComparison.Ordinal)
                    ? "/private" + _temporary.Path
                    : _temporary.Path;
            string root = Path.Combine(_physical, "replica");
            Directory.CreateDirectory(root);
            Profile = new FacetProfileRegistration(
                "p",
                "Fixture",
                root,
                true,
                true,
                "owner",
                new ObsidianVaultChoice(
                    "fixture-vault",
                    "Fixture",
                    "sync-test.obsidian.md",
                    "test",
                    salt,
                    encryptionVersion,
                    false,
                    false
                )
            );
        }

        internal async Task<FacetEngineService> OpenEngineAsync(CancellationToken cancellationToken)
        {
            FacetEngineService engine = FacetPortableCapability.Open(
                Path.Combine(_physical, "facet.sqlite"),
                [new FacetFolderCapability("p", Profile.RootPath, true)]
            );
            await engine.InitializeAsync(cancellationToken);
            await engine.RegisterProfileAsync(
                "p",
                "Fixture",
                Profile.RootPath,
                true,
                true,
                cancellationToken
            );
            await engine.RefreshAsync("p", cancellationToken);
            return engine;
        }

        public void Dispose() => _temporary.Dispose();
    }

    /// <summary>Framework cancellation and diagnostics.</summary>
    public required TestContext TestContext { get; set; }
}
