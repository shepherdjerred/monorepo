using System.Collections.Concurrent;
using System.Net.Http.Headers;
using Microsoft.VisualStudio.Threading;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Host
{
    internal sealed class BearerHttpTransport : Core.HttpClient, IDisposable
    {
        private readonly HttpClient _client;
        private readonly string? _token;
        private readonly ConcurrentDictionary<long, ActiveRequest> _active = new();
        private readonly JoinableTaskContext _joinableTaskContext = new();
        private long _requestId;
        private bool _disposed;

        internal BearerHttpTransport(string? token, HttpMessageHandler? handler = null)
        {
            // Tokens are pasted, so they arrive with trailing newlines and spaces that
            // would otherwise reach the Authorization header verbatim and fail auth.
            string? normalized = token?.Trim();
            _token = string.IsNullOrEmpty(normalized) ? null : normalized;
            _client = handler is null ? new HttpClient() : new HttpClient(handler, true);
        }

        public Core.HttpResponse Send(Core.HttpRequest request)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            ArgumentNullException.ThrowIfNull(request);

            long id = Interlocked.Increment(ref _requestId);
            using ActiveRequest active = new(TimeSpan.FromMilliseconds(request.TimeoutMillis));
            if (!_active.TryAdd(id, active))
            {
                throw new Core.TransportException.Other($"request {id} already exists");
            }

            try
            {
                using HttpRequestMessage message = CreateMessage(request);
                using HttpResponseMessage response = _client.Send(
                    message,
                    HttpCompletionOption.ResponseHeadersRead,
                    active.Token
                );
                byte[] body = ReadBody(response.Content, active.Token);
                List<Core.HttpHeader> headers = [];
                AddHeaders(headers, response.Headers);
                AddHeaders(headers, response.Content.Headers);
                return new Core.HttpResponse((ushort)response.StatusCode, [.. headers], body);
            }
            catch (OperationCanceledException exception) when (active.WasCancelledByHost)
            {
                throw new Core.TransportException.Other(
                    $"request was cancelled: {exception.Message}"
                );
            }
            catch (OperationCanceledException exception)
            {
                throw new Core.TransportException.Timeout(
                    $"request timed out or was cancelled: {exception.Message}"
                );
            }
            catch (HttpRequestException exception)
            {
                throw Map(exception);
            }
            finally
            {
                _ = _active.TryRemove(id, out _);
            }
        }

        public void CancelAll()
        {
            foreach (ActiveRequest active in _active.Values)
            {
                active.CancelByHost();
            }
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            CancelAll();
            _client.Dispose();
            _joinableTaskContext.Dispose();
        }

        private HttpRequestMessage CreateMessage(Core.HttpRequest request)
        {
            HttpRequestMessage message = new(ToMethod(request.Method), request.Url);
            if (request.Body is not null)
            {
                message.Content = new ByteArrayContent(request.Body);
            }

            foreach (Core.HttpHeader header in request.Headers)
            {
                if (!message.Headers.TryAddWithoutValidation(header.Name, header.Value))
                {
                    message.Content ??= new ByteArrayContent([]);
                    _ = message.Content.Headers.TryAddWithoutValidation(header.Name, header.Value);
                }
            }

            if (_token is not null)
            {
                message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);
            }
            return message;
        }

        private static HttpMethod ToMethod(Core.HttpMethod method)
        {
            return method switch
            {
                Core.HttpMethod.Get => HttpMethod.Get,
                Core.HttpMethod.Post => HttpMethod.Post,
                Core.HttpMethod.Put => HttpMethod.Put,
                Core.HttpMethod.Delete => HttpMethod.Delete,
                _ => throw new ArgumentOutOfRangeException(nameof(method)),
            };
        }

        private static void AddHeaders(List<Core.HttpHeader> target, HttpHeaders headers)
        {
            foreach (KeyValuePair<string, IEnumerable<string>> header in headers)
            {
                foreach (string value in header.Value)
                {
                    target.Add(new Core.HttpHeader(header.Key, value));
                }
            }
        }

        private byte[] ReadBody(HttpContent content, CancellationToken cancellationToken)
        {
            using Stream source = content.ReadAsStream(cancellationToken);
            using MemoryStream destination = new();
            // A synchronous Stream.Read ignores the token and only returns once the
            // server sends or drops the connection, so a stalled body would pin the
            // sole EngineRunner worker past both the request timeout and CancelAll.
            // CopyToAsync reads through the cancellation-aware path instead, joined
            // the way every other sync-over-async boundary in this host is.
            _joinableTaskContext.Factory.Run(() =>
                source.CopyToAsync(destination, cancellationToken)
            );
            return destination.ToArray();
        }

        private static Core.TransportException Map(HttpRequestException exception)
        {
            return exception.HttpRequestError switch
            {
                HttpRequestError.NameResolutionError => new Core.TransportException.Offline(
                    exception.Message
                ),
                HttpRequestError.ConnectionError => new Core.TransportException.Offline(
                    exception.Message
                ),
                HttpRequestError.SecureConnectionError => new Core.TransportException.Tls(
                    exception.Message
                ),
                HttpRequestError.ProxyTunnelError => new Core.TransportException.Offline(
                    exception.Message
                ),
                HttpRequestError.Unknown => new Core.TransportException.Other(exception.Message),
                HttpRequestError.HttpProtocolError => new Core.TransportException.Other(
                    exception.Message
                ),
                HttpRequestError.ExtendedConnectNotSupported => new Core.TransportException.Other(
                    exception.Message
                ),
                HttpRequestError.VersionNegotiationError => new Core.TransportException.Other(
                    exception.Message
                ),
                HttpRequestError.UserAuthenticationError => new Core.TransportException.Other(
                    exception.Message
                ),
                HttpRequestError.InvalidResponse => new Core.TransportException.Other(
                    exception.Message
                ),
                HttpRequestError.ResponseEnded => new Core.TransportException.Other(
                    exception.Message
                ),
                HttpRequestError.ConfigurationLimitExceeded => new Core.TransportException.Other(
                    exception.Message
                ),
                _ => new Core.TransportException.Other(exception.Message),
            };
        }

        // Internal rather than private so a unit test can assert the disposal contract
        // below directly. Reaching it through CancelAll means racing a request to
        // completion, which lands the guard only when the scheduler cooperates and makes
        // the measured coverage of this file depend on thread timing.
        internal sealed class ActiveRequest : IDisposable
        {
            private readonly CancellationTokenSource _cancellation = new();

            // CancelAll walks a snapshot of the active requests, so a request that
            // finishes between the snapshot and the call has already removed itself and
            // disposed this source. Cancelling it then threw ObjectDisposedException out
            // of DisposeAsync. The gate makes the two operations exclusive, and a request
            // that already completed simply has nothing left to cancel.
            private readonly object _gate = new();
            private int _cancelledByHost;
            private bool _disposed;

            internal ActiveRequest(TimeSpan timeout)
            {
                _cancellation.CancelAfter(timeout);
            }

            internal CancellationToken Token => _cancellation.Token;

            internal bool WasCancelledByHost => Volatile.Read(ref _cancelledByHost) == 1;

            internal void CancelByHost()
            {
                lock (_gate)
                {
                    if (_disposed)
                    {
                        return;
                    }
                    _ = Interlocked.Exchange(ref _cancelledByHost, 1);
                    _cancellation.Cancel();
                }
            }

            public void Dispose()
            {
                lock (_gate)
                {
                    if (_disposed)
                    {
                        return;
                    }
                    _disposed = true;
                    _cancellation.Dispose();
                }
            }
        }
    }
}
