using System.Net.WebSockets;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>Transport framing is bounded independently of protocol semantics.</summary>
[TestClass]
public sealed class FacetSocketTests
{
    private const int BinaryMaximum = 2 * 1024 * 1024;
    private const int TextMaximum = 4 * 1024 * 1024;

    /// <summary>Peer closure and invalid configured limits never enter the protocol parser.</summary>
    [TestMethod]
    public async Task PeerCloseAndInvalidLimitsAreTypedTransportFailures()
    {
        using FragmentSocket closed = new([], type: WebSocketMessageType.Close);
        _ = await Assert.ThrowsExactlyAsync<WebSocketException>(() =>
            FacetSocketFrames.ReadAsync(
                closed,
                BinaryMaximum,
                TextMaximum,
                TestContext.CancellationToken
            )
        );
        using FragmentSocket valid = new([]);
        _ = await Assert.ThrowsExactlyAsync<ArgumentOutOfRangeException>(() =>
            FacetSocketFrames.ReadAsync(valid, 0, TextMaximum, TestContext.CancellationToken)
        );
        _ = await Assert.ThrowsExactlyAsync<ArgumentOutOfRangeException>(() =>
            FacetSocketFrames.ReadAsync(valid, BinaryMaximum, 0, TestContext.CancellationToken)
        );
    }

    /// <summary>A fragmented official-size binary piece remains intact.</summary>
    [TestMethod]
    public async Task LegalTwoMebibytePieceSurvivesFragmentation()
    {
        byte[] bytes = new byte[BinaryMaximum];
        for (int index = 0; index < bytes.Length; index++)
            bytes[index] = (byte)(index % 251);
        using FragmentSocket socket = new(bytes);
        var frame = await FacetSocketFrames.ReadAsync(
            socket,
            BinaryMaximum,
            TextMaximum,
            TestContext.CancellationToken
        );
        Assert.AreEqual(WebSocketMessageType.Binary, frame.Type);
        CollectionAssert.AreEqual(bytes, frame.Bytes);
        Assert.IsTrue(socket.Reads > 100);
    }

    /// <summary>Oversized frames fail before allocating an unbounded aggregate or calling Rust.</summary>
    [TestMethod]
    public async Task BinaryPieceLimitRejectsFirstExcessByte()
    {
        using FragmentSocket socket = new(new byte[BinaryMaximum + 1]);
        _ = await Assert.ThrowsExactlyAsync<FacetFrameException>(() =>
            FacetSocketFrames.ReadAsync(
                socket,
                BinaryMaximum,
                TextMaximum,
                TestContext.CancellationToken
            )
        );
    }

    /// <summary>The full core-authored text limit and its first excess byte are enforced.</summary>
    [TestMethod]
    public async Task TextLimitAcceptsExactSizeAndRejectsExcess()
    {
        using FragmentSocket exact = new(new byte[TextMaximum], type: WebSocketMessageType.Text);
        Assert.AreEqual(
            TextMaximum,
            (
                await FacetSocketFrames.ReadAsync(
                    exact,
                    BinaryMaximum,
                    TextMaximum,
                    TestContext.CancellationToken
                )
            )
                .Bytes
                .Length
        );
        using FragmentSocket excessive = new(
            new byte[TextMaximum + 1],
            type: WebSocketMessageType.Text
        );
        _ = await Assert.ThrowsExactlyAsync<FacetFrameException>(() =>
            FacetSocketFrames.ReadAsync(
                excessive,
                BinaryMaximum,
                TextMaximum,
                TestContext.CancellationToken
            )
        );
    }

    /// <summary>Fragment type changes and invalid UTF-8 cannot masquerade as valid protocol input.</summary>
    [TestMethod]
    public async Task MixedFragmentTypesAndInvalidUtf8AreRejected()
    {
        using FragmentSocket socket = new(new byte[32768], mixedTypes: true);
        _ = await Assert.ThrowsExactlyAsync<FacetFrameException>(() =>
            FacetSocketFrames.ReadAsync(
                socket,
                BinaryMaximum,
                TextMaximum,
                TestContext.CancellationToken
            )
        );
        _ = Assert.ThrowsExactly<FacetFrameException>(() =>
            FacetSocketFrames.DecodeText([0xff, 0xfe])
        );
    }

    /// <summary>Gets the cancellation context.</summary>
    public required TestContext TestContext { get; set; }

    private sealed class FragmentSocket(
        byte[] bytes,
        bool mixedTypes = false,
        WebSocketMessageType type = WebSocketMessageType.Binary
    ) : IFacetSocket
    {
        private int _position;
        internal int Reads { get; private set; }

        public Task ConnectAsync(Uri uri, CancellationToken cancellationToken) =>
            Task.CompletedTask;

        public ValueTask SendAsync(
            ReadOnlyMemory<byte> payload,
            WebSocketMessageType type,
            CancellationToken cancellationToken
        ) => ValueTask.CompletedTask;

        public ValueTask<ValueWebSocketReceiveResult> ReceiveAsync(
            Memory<byte> buffer,
            CancellationToken cancellationToken
        )
        {
            cancellationToken.ThrowIfCancellationRequested();
            int count = Math.Min(buffer.Length, bytes.Length - _position);
            bytes.AsMemory(_position, count).CopyTo(buffer);
            _position += count;
            Reads++;
            return ValueTask.FromResult(
                new ValueWebSocketReceiveResult(
                    count,
                    mixedTypes && Reads > 1 ? WebSocketMessageType.Text : type,
                    _position == bytes.Length
                )
            );
        }

        public void Abort() { }

        public void Dispose() { }
    }
}
