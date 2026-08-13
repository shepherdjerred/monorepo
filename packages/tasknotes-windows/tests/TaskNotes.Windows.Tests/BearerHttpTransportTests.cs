using System.Net;
using TaskNotes.Windows.Host;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Tests
{
    /// <summary>Verifies the host HTTP boundary without changing core-authored requests.</summary>
    [TestClass]
    public sealed class BearerHttpTransportTests
    {
        /// <summary>Preserves request data, adds bearer authorization, and returns non-success responses.</summary>
        [TestMethod]
        public void RequestPreservesCoreMethodUrlHeadersAndBodyAndReturnsErrorStatuses()
        {
            RecordingHandler handler = new();
            using BearerHttpTransport transport = new("secret-token", handler);
            Core.HttpRequest request = new(
                Core.HttpMethod.Put,
                "https://tasks.example.test/v2/tasks/a%20b",
                [
                    new Core.HttpHeader("X-Mutation-Id", "command-1"),
                    new Core.HttpHeader("Content-Type", "application/json"),
                ],
                /*lang=json,strict*/
                "{\"done\":true}"u8.ToArray(),
                5_000
            );

            Core.HttpResponse response = transport.Send(request);

            Assert.AreEqual((ushort)418, response.Status);
            Assert.AreEqual(HttpMethod.Put, handler.Method);
            Assert.AreEqual("https://tasks.example.test/v2/tasks/a%20b", handler.Url);
            Assert.AreEqual("Bearer secret-token", handler.Authorization);
            Assert.AreEqual("command-1", handler.MutationId);
            Assert.AreSequenceEqual(request.Body, handler.Body);
            Assert.AreSequenceEqual("response"u8.ToArray(), response.Body);
            Assert.IsTrue(
                response.Headers.Any(header =>
                    header.Name.Equals("X-TaskNotes-Server", StringComparison.OrdinalIgnoreCase)
                )
            );
        }

        /// <summary>Leaves authorization absent when an open server has no configured token.</summary>
        [TestMethod]
        public void OpenServerRequestDoesNotInventAnAuthorizationHeader()
        {
            RecordingHandler handler = new();
            using BearerHttpTransport transport = new(null, handler);
            Core.HttpRequest request = new(
                Core.HttpMethod.Get,
                "https://tasks.example.test/v2/tasks",
                [new Core.HttpHeader("X-Mutation-Id", "command-2")],
                null,
                5_000
            );

            _ = transport.Send(request);

            Assert.IsNull(handler.Authorization);
        }

        /// <summary>Interrupts blocked transport work from another thread.</summary>
        [TestMethod]
        public async Task CancelAllInterruptsAnInflightRequest()
        {
            BlockingHandler handler = new();
            using BearerHttpTransport transport = new("secret-token", handler);
            Core.HttpRequest request = new(
                Core.HttpMethod.Get,
                "https://tasks.example.test/v2/tasks",
                [],
                null,
                60_000
            );
            Task<Exception?> sending = Task.Run(() =>
            {
                try
                {
                    _ = transport.Send(request);
                    return null;
                }
                catch (Exception exception)
                {
                    return exception;
                }
            });
            await handler.Started.Task.WaitAsync(
                TimeSpan.FromSeconds(5),
                TestContext.CancellationToken
            );

            transport.CancelAll();
            Exception? exception = await sending.WaitAsync(
                TimeSpan.FromSeconds(5),
                TestContext.CancellationToken
            );

            _ = Assert.IsInstanceOfType<Core.TransportException.Other>(exception);
        }

        /// <summary>Maps every modeled network failure without leaking HttpClient exceptions.</summary>
        [TestMethod]
        [DataRow(HttpRequestError.NameResolutionError, typeof(Core.TransportException.Offline))]
        [DataRow(HttpRequestError.ConnectionError, typeof(Core.TransportException.Offline))]
        [DataRow(HttpRequestError.ProxyTunnelError, typeof(Core.TransportException.Offline))]
        [DataRow(HttpRequestError.SecureConnectionError, typeof(Core.TransportException.Tls))]
        [DataRow(HttpRequestError.HttpProtocolError, typeof(Core.TransportException.Other))]
        [DataRow(HttpRequestError.InvalidResponse, typeof(Core.TransportException.Other))]
        [DataRow(HttpRequestError.Unknown, typeof(Core.TransportException.Other))]
        public void NetworkFailuresMapToCoreTransportErrors(HttpRequestError error, Type expected)
        {
            using BearerHttpTransport transport = new(null, new ThrowingHandler(error));
            Core.HttpRequest request = new(
                Core.HttpMethod.Get,
                "https://tasks.example.test/v2/tasks",
                [],
                null,
                5_000
            );

            Exception exception = Assert.Throws<Core.TransportException>(() =>
                transport.Send(request)
            );

            Assert.AreEqual(expected, exception.GetType());
        }

        /// <summary>Maps local timeouts and rejects calls after idempotent disposal.</summary>
        [TestMethod]
        public void TimeoutAndDisposalAreExplicit()
        {
            BearerHttpTransport transport = new(null, new TimeoutHandler());
            Core.HttpRequest request = new(
                Core.HttpMethod.Get,
                "https://tasks.example.test/v2/tasks",
                [],
                null,
                1
            );
            _ = Assert.ThrowsExactly<Core.TransportException.Timeout>(() =>
                transport.Send(request)
            );
            transport.Dispose();
            transport.Dispose();
            _ = Assert.ThrowsExactly<ObjectDisposedException>(() => transport.Send(request));
        }

        /// <summary>Maps every supported core verb without altering the URL.</summary>
        [TestMethod]
        public void CoreMethodsMapExactly()
        {
            (Core.HttpMethod Method, string Expected)[] cases =
            [
                (Core.HttpMethod.Get, "GET"),
                (Core.HttpMethod.Post, "POST"),
                (Core.HttpMethod.Put, "PUT"),
                (Core.HttpMethod.Delete, "DELETE"),
            ];
            foreach ((Core.HttpMethod method, string expected) in cases)
            {
                RecordingHandler handler = new();
                using BearerHttpTransport transport = new(null, handler);
                _ = transport.Send(
                    new Core.HttpRequest(method, "https://tasks.example.test/path", [], null, 5_000)
                );
                Assert.AreEqual(expected, handler.Method?.Method);
            }
        }

        private sealed class RecordingHandler : HttpMessageHandler
        {
            internal HttpMethod? Method { get; private set; }
            internal string? Url { get; private set; }
            internal string? Authorization { get; private set; }
            internal string? MutationId { get; private set; }
            internal byte[]? Body { get; private set; }

            protected override HttpResponseMessage Send(
                HttpRequestMessage request,
                CancellationToken cancellationToken
            )
            {
                Method = request.Method;
                Url = request.RequestUri?.AbsoluteUri;
                Authorization = request.Headers.Authorization?.ToString();
                MutationId = request.Headers.TryGetValues(
                    "X-Mutation-Id",
                    out IEnumerable<string>? mutationIds
                )
                    ? mutationIds.Single()
                    : null;
                if (request.Content is not null)
                {
                    using Stream source = request.Content.ReadAsStream(cancellationToken);
                    using MemoryStream destination = new();
                    source.CopyTo(destination);
                    Body = destination.ToArray();
                }
                HttpResponseMessage response = new((HttpStatusCode)418)
                {
                    Content = new ByteArrayContent("response"u8.ToArray()),
                };
                response.Headers.Add("X-TaskNotes-Server", "test");
                return response;
            }

            protected override Task<HttpResponseMessage> SendAsync(
                HttpRequestMessage request,
                CancellationToken cancellationToken
            )
            {
                return Task.FromResult(Send(request, cancellationToken));
            }
        }

        private sealed class BlockingHandler : HttpMessageHandler
        {
            internal TaskCompletionSource Started { get; } =
                new(TaskCreationOptions.RunContinuationsAsynchronously);

            protected override HttpResponseMessage Send(
                HttpRequestMessage request,
                CancellationToken cancellationToken
            )
            {
                _ = request;
                _ = Started.TrySetResult();
                _ = cancellationToken.WaitHandle.WaitOne();
                cancellationToken.ThrowIfCancellationRequested();
                throw new InvalidOperationException("Cancellation did not interrupt the request.");
            }

            protected override Task<HttpResponseMessage> SendAsync(
                HttpRequestMessage request,
                CancellationToken cancellationToken
            )
            {
                return Task.FromResult(Send(request, cancellationToken));
            }
        }

        private sealed class ThrowingHandler(HttpRequestError error) : HttpMessageHandler
        {
            protected override HttpResponseMessage Send(
                HttpRequestMessage request,
                CancellationToken cancellationToken
            )
            {
                _ = request;
                _ = cancellationToken;
                throw new HttpRequestException(error, "network failed");
            }

            protected override Task<HttpResponseMessage> SendAsync(
                HttpRequestMessage request,
                CancellationToken cancellationToken
            ) => Task.FromResult(Send(request, cancellationToken));
        }

        /// <summary>Times out a response whose headers arrive before the body stalls.</summary>
        [TestMethod]
        public void StalledResponseBodyHonorsTheRequestTimeout()
        {
            using BearerHttpTransport transport = new(null, new StalledBodyHandler());
            Core.HttpRequest request = new(
                Core.HttpMethod.Get,
                "https://tasks.example.test/v2/tasks",
                [],
                null,
                50
            );

            _ = Assert.ThrowsExactly<Core.TransportException.Timeout>(() =>
                transport.Send(request)
            );
        }

        private sealed class StalledBodyHandler : HttpMessageHandler
        {
            protected override HttpResponseMessage Send(
                HttpRequestMessage request,
                CancellationToken cancellationToken
            )
            {
                _ = request;
                _ = cancellationToken;
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StreamContent(new StalledStream()),
                };
            }

            protected override Task<HttpResponseMessage> SendAsync(
                HttpRequestMessage request,
                CancellationToken cancellationToken
            ) => Task.FromResult(Send(request, cancellationToken));
        }

        /// <summary>A body that never arrives and that only the cancellable path can abandon.</summary>
        private sealed class StalledStream : Stream
        {
            public override bool CanRead => true;
            public override bool CanSeek => false;
            public override bool CanWrite => false;
            public override long Length => throw new NotSupportedException();
            public override long Position
            {
                get => throw new NotSupportedException();
                set => throw new NotSupportedException();
            }

            // A real stalled socket blocks here forever. Refusing the call keeps a
            // regression a fast failure instead of a hung suite, and asserts that the
            // transport reads the body through the cancellation-aware path.
            public override int Read(byte[] buffer, int offset, int count) =>
                throw new NotSupportedException(
                    "The response body must be read through a cancellation-aware API."
                );

            public override async ValueTask<int> ReadAsync(
                Memory<byte> buffer,
                CancellationToken cancellationToken = default
            )
            {
                await Task.Delay(Timeout.Infinite, cancellationToken).ConfigureAwait(false);
                return 0;
            }

            public override void Flush() { }

            public override long Seek(long offset, SeekOrigin origin) =>
                throw new NotSupportedException();

            public override void SetLength(long value) => throw new NotSupportedException();

            public override void Write(byte[] buffer, int offset, int count) =>
                throw new NotSupportedException();
        }

        private sealed class TimeoutHandler : HttpMessageHandler
        {
            protected override HttpResponseMessage Send(
                HttpRequestMessage request,
                CancellationToken cancellationToken
            )
            {
                _ = request;
                _ = cancellationToken.WaitHandle.WaitOne();
                throw new OperationCanceledException(cancellationToken);
            }

            protected override Task<HttpResponseMessage> SendAsync(
                HttpRequestMessage request,
                CancellationToken cancellationToken
            ) => Task.FromResult(Send(request, cancellationToken));
        }

        /// <summary>Gets or sets the MSTest execution context.</summary>
        public required TestContext TestContext { get; set; }
    }
}
