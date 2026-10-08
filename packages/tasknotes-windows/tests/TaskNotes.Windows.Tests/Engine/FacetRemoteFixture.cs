using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using TaskNotes.Windows.Host;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Tests;

/// <summary>Offline authenticated protocol producer for exact fixture bytes; actual owned download and durable checkpoint barriers execute.</summary>
internal static class FacetRemoteFixture
{
    internal static Task ApplyAsync(
        FacetEngineService engine,
        string profile,
        string path,
        byte[]? bytes,
        string metadata,
        CancellationToken cancellationToken
    ) =>
        engine.Runner.RunAsync(
            () =>
            {
                using var notice = JsonDocument.Parse(metadata);
                ulong uid = notice.RootElement.GetProperty("uid").GetUInt64();
                string checkpoint = engine.Engine.LoadCheckpoint(profile) ?? "";
                ulong cursor = 0;
                if (checkpoint.Length > 0)
                {
                    using var saved = JsonDocument.Parse(checkpoint);
                    cursor = saved.RootElement.GetProperty("cursor").GetUInt64();
                    if (saved.RootElement.GetProperty("pending").EnumerateObject().Any())
                        throw new InvalidDataException(
                            "Fixture setup must finish each original pending notice before changing sessions."
                        );
                }
                if (uid <= cursor)
                    throw new InvalidDataException("Fixture service revisions must increase.");
                using var session = new Core.FfiObsidianSession(
                    new Core.ObsidianSessionOptions(
                        "sync-test.obsidian.md",
                        "synthetic-fixture-token",
                        "fixture-vault",
                        "Offline fixture",
                        0,
                        "public-salt",
                        new byte[32],
                        checkpoint,
                        null
                    )
                );
                session.BindRuntime(engine.Engine, profile);
                int applied = 0;
                bool pull = false;
                void Process(IEnumerable<Core.ObsidianSessionEffect> initial)
                {
                    Queue<Core.ObsidianSessionEffect> effects = new(initial);
                    while (effects.TryDequeue(out var effect))
                    {
                        Core.ObsidianSessionEffect[] more = [];
                        switch (effect)
                        {
                            case Core.ObsidianSessionEffect.PersistCheckpoint value:
                                engine.Engine.SaveCheckpoint(profile, value.CheckpointJson);
                                more = session.CheckpointPersisted(value.Revision, 0);
                                break;
                            case Core.ObsidianSessionEffect.PersistCheckpointDelta value:
                                engine.Engine.ApplySyncCheckpointDelta(profile, value.DeltaJson);
                                more = session.CheckpointPersisted(value.Revision, 0);
                                break;
                            case Core.ObsidianSessionEffect.RemoteChange value:
                                using (var file = JsonDocument.Parse(value.MetadataJson))
                                {
                                    if (file.RootElement.GetProperty("uid").GetUInt64() != uid)
                                        throw new InvalidDataException(
                                            "The fixture notice identity changed."
                                        );
                                    more = session.QueueDownload(uid, 0);
                                }
                                break;
                            case Core.ObsidianSessionEffect.DownloadedPayload value:
                                if (
                                    value.Uid != uid
                                    || value.Deleted != (bytes is null)
                                    || value.PayloadSize != checked((ulong)(bytes?.LongLength ?? 0))
                                )
                                    throw new InvalidDataException(
                                        "The authenticated fixture payload differs from its original intent."
                                    );
                                session.ApplyDownload(value.TransferId);
                                applied++;
                                more = session.CompleteRemote(uid);
                                break;
                            case Core.ObsidianSessionEffect.SendText value:
                                using (var frame = JsonDocument.Parse(value.Text))
                                    if (
                                        frame.RootElement.TryGetProperty("op", out var operation)
                                        && operation.GetString() == "pull"
                                    )
                                        pull = true;
                                break;
                            case Core.ObsidianSessionEffect.Failed value:
                                throw new InvalidDataException(
                                    "The offline protocol fixture failed: " + value.Code
                                );
                            case Core.ObsidianSessionEffect.Connect
                            or Core.ObsidianSessionEffect.Ready
                            or Core.ObsidianSessionEffect.Close:
                                break;
                            default:
                                throw new InvalidDataException(
                                    "Unexpected offline fixture effect."
                                );
                        }
                        foreach (var next in more)
                            effects.Enqueue(next);
                    }
                }
                try
                {
                    Process(session.Begin(0));
                    Process(session.Opened(0));
                    Process(session.ReceiveText("{\"res\":\"ok\"}", 0));
                    Process(
                        session.ReceiveText(
                            JsonSerializer.Serialize(new { op = "ready", version = cursor }),
                            0
                        )
                    );
                    string hash = bytes is null
                        ? ""
                        : Convert.ToHexStringLower(SHA256.HashData(bytes));
                    Process(
                        session.ReceiveText(
                            JsonSerializer.Serialize(
                                new
                                {
                                    op = "push",
                                    uid,
                                    path = EncodeString(path),
                                    relatedpath = (string?)null,
                                    size = bytes?.LongLength ?? 0,
                                    hash = hash.Length == 0 ? "" : EncodeString(hash),
                                    ctime = notice.RootElement.GetProperty("ctime").GetUInt64(),
                                    mtime = notice.RootElement.GetProperty("mtime").GetUInt64(),
                                    folder = false,
                                    deleted = bytes is null,
                                }
                            ),
                            0
                        )
                    );
                    if (!pull)
                        throw new InvalidDataException("The fixture download was not admitted.");
                    if (bytes is null)
                        Process(session.ReceiveText("{\"deleted\":true}", 0));
                    else
                    {
                        byte[] frame =
                            bytes.Length == 0
                                ? []
                                : Encrypt(bytes, RandomNumberGenerator.GetBytes(12));
                        const int pieceSize = 2 * 1024 * 1024;
                        Process(
                            session.ReceiveText(
                                JsonSerializer.Serialize(
                                    new
                                    {
                                        size = frame.Length,
                                        pieces = (frame.Length + pieceSize - 1) / pieceSize,
                                    }
                                ),
                                0
                            )
                        );
                        for (int offset = 0; offset < frame.Length; offset += pieceSize)
                            Process(
                                session.ReceiveBinary(
                                    frame
                                        .AsSpan(offset, Math.Min(pieceSize, frame.Length - offset))
                                        .ToArray(),
                                    0
                                )
                            );
                    }
                    if (applied != 1)
                        throw new InvalidDataException(
                            "The fixture did not apply exactly one original download."
                        );
                    return true;
                }
                finally
                {
                    session.UnbindRuntime(0);
                }
            },
            cancellationToken
        );

    private static string EncodeString(string text)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(text);
        return Convert.ToHexStringLower(
            Encrypt(bytes, SHA256.HashData(bytes).AsSpan(0, 12).ToArray())
        );
    }

    private static byte[] Encrypt(byte[] plaintext, byte[] nonce)
    {
        byte[] result = new byte[plaintext.Length + 28];
        nonce.CopyTo(result, 0);
        using AesGcm aes = new(new byte[32], 16);
        aes.Encrypt(
            nonce,
            plaintext,
            result.AsSpan(12, plaintext.Length),
            result.AsSpan(12 + plaintext.Length, 16)
        );
        return result;
    }
}
