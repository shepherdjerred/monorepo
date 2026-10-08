using System.Buffers;
using System.Net.WebSockets;
using System.Text;

namespace TaskNotes.Windows.Host;

internal interface IFacetSocket : IDisposable
{
    Task ConnectAsync(Uri uri, CancellationToken cancellationToken);
    ValueTask SendAsync(
        ReadOnlyMemory<byte> bytes,
        WebSocketMessageType type,
        CancellationToken cancellationToken
    );
    ValueTask<ValueWebSocketReceiveResult> ReceiveAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken
    );
    void Abort();
}

internal sealed class FacetSocket : IFacetSocket
{
    private readonly ClientWebSocket _socket = new();

    internal FacetSocket() => _socket.Options.KeepAliveInterval = Timeout.InfiniteTimeSpan;

    public Task ConnectAsync(Uri uri, CancellationToken cancellationToken) =>
        _socket.ConnectAsync(uri, cancellationToken);

    public ValueTask SendAsync(
        ReadOnlyMemory<byte> bytes,
        WebSocketMessageType type,
        CancellationToken cancellationToken
    ) => _socket.SendAsync(bytes, type, true, cancellationToken);

    public ValueTask<ValueWebSocketReceiveResult> ReceiveAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken
    ) => _socket.ReceiveAsync(buffer, cancellationToken);

    public void Abort() => _socket.Abort();

    public void Dispose() => _socket.Dispose();
}

internal sealed class FacetFrameException(string message) : IOException(message);

internal static class FacetSocketFrames
{
    internal static async Task<(WebSocketMessageType Type, byte[] Bytes)> ReadAsync(
        IFacetSocket socket,
        int binaryMaximum,
        int textMaximum,
        CancellationToken cancellationToken
    )
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(binaryMaximum);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(textMaximum);
        byte[] buffer = ArrayPool<byte>.Shared.Rent(16384);
        try
        {
            using MemoryStream message = new();
            WebSocketMessageType? type = null;
            ValueWebSocketReceiveResult fragment;
            do
            {
                fragment = await socket
                    .ReceiveAsync(buffer.AsMemory(), cancellationToken)
                    .ConfigureAwait(false);
                if (fragment.MessageType == WebSocketMessageType.Close)
                    throw new WebSocketException("The peer closed Sync.");
                if (
                    fragment.MessageType
                    is not WebSocketMessageType.Text
                        and not WebSocketMessageType.Binary
                )
                    throw new FacetFrameException("The Sync message type is unsupported.");
                if (type is not null && type != fragment.MessageType)
                    throw new FacetFrameException(
                        "The Sync message changed type between fragments."
                    );
                type = fragment.MessageType;
                int maximum = type == WebSocketMessageType.Binary ? binaryMaximum : textMaximum;
                if (message.Length + fragment.Count > maximum)
                    throw new FacetFrameException("The Sync message exceeded its transport limit.");
                await message
                    .WriteAsync(buffer.AsMemory(0, fragment.Count), cancellationToken)
                    .ConfigureAwait(false);
            } while (!fragment.EndOfMessage);
            return (type!.Value, message.ToArray());
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer, true);
        }
    }

    internal static string DecodeText(byte[] bytes)
    {
        try
        {
            return new UTF8Encoding(false, true).GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            throw new FacetFrameException("The Sync text message is not UTF-8.");
        }
    }
}
