using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using TaskNotes.Protocol;

namespace TaskNotes.Windows.Host;

/// <summary>Health check reading returned by <c>GET /api/health</c>.</summary>
public sealed record FacetHealthStatus(bool Ok, bool Authenticated);

/// <summary>Typed HTTP client for the Facet <c>/api/v1/sync</c> and <c>/api/health</c> endpoints.</summary>
public sealed class FacetApiClient : IDisposable
{
    private readonly HttpClient _httpClient;
    private readonly bool _ownsClient;

    /// <summary>Initializes a client owning a dedicated <see cref="HttpClient"/>.</summary>
    public FacetApiClient()
        : this(new HttpClient { Timeout = TimeSpan.FromSeconds(30) }, ownsClient: true) { }

    /// <summary>Initializes a client over a caller-supplied <see cref="HttpClient"/>.</summary>
    public FacetApiClient(HttpClient httpClient, bool ownsClient = false)
    {
        ArgumentNullException.ThrowIfNull(httpClient);
        _httpClient = httpClient;
        _ownsClient = ownsClient;
    }

    /// <summary>Posts a <see cref="SyncRequest"/> to <c>/api/v1/sync</c> using Bearer authentication.</summary>
    public async Task<SyncResponse> SyncAsync(
        string serverUrl,
        string? token,
        SyncRequest request,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(request);
        Uri endpoint = BuildEndpoint(serverUrl, "/api/v1/sync");
        string payload = JsonSerializer.Serialize(request, FacetProtocolJson.Options);
        using HttpRequestMessage message = new(HttpMethod.Post, endpoint)
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json"),
        };
        AttachCredentials(message, token);

        using HttpResponseMessage response = await SendAsync(message, cancellationToken)
            .ConfigureAwait(false);
        string body = await response
            .Content.ReadAsStringAsync(cancellationToken)
            .ConfigureAwait(false);
        EnsureSuccess(response.StatusCode, body);

        try
        {
            return JsonSerializer.Deserialize<SyncResponse>(body, FacetProtocolJson.Options)
                ?? throw new FacetApiException("Sync response body was null.", 200);
        }
        catch (JsonException error)
        {
            throw new FacetApiException(
                "Sync response did not match the Facet protocol contract.",
                (ushort)response.StatusCode,
                error
            );
        }
    }

    /// <summary>Probes <c>/api/health</c> on the configured server.</summary>
    public async Task<FacetHealthStatus> CheckHealthAsync(
        string serverUrl,
        string? token,
        CancellationToken cancellationToken = default
    )
    {
        Uri endpoint = BuildEndpoint(serverUrl, "/api/health");
        using HttpRequestMessage message = new(HttpMethod.Get, endpoint);
        AttachCredentials(message, token);

        using HttpResponseMessage response = await SendAsync(message, cancellationToken)
            .ConfigureAwait(false);
        string body = await response
            .Content.ReadAsStringAsync(cancellationToken)
            .ConfigureAwait(false);
        EnsureSuccess(response.StatusCode, body);

        try
        {
            using JsonDocument document = JsonDocument.Parse(body);
            JsonElement root = document.RootElement;
            if (
                root.TryGetProperty("data", out JsonElement data)
                && data.ValueKind == JsonValueKind.Object
            )
            {
                bool ok =
                    data.TryGetProperty("status", out JsonElement statusProp)
                    && string.Equals(statusProp.GetString(), "ok", StringComparison.Ordinal);
                bool authenticated =
                    data.TryGetProperty("authenticated", out JsonElement authProp)
                    && authProp.ValueKind == JsonValueKind.True;
                return new FacetHealthStatus(ok, authenticated);
            }

            bool directOk =
                root.TryGetProperty("status", out JsonElement directStatus)
                && string.Equals(directStatus.GetString(), "ok", StringComparison.Ordinal);
            return new FacetHealthStatus(directOk, false);
        }
        catch (JsonException error)
        {
            throw new FacetApiException(
                "Health response was not valid JSON.",
                (ushort)response.StatusCode,
                error
            );
        }
    }

    /// <summary>Disposes the underlying <see cref="HttpClient"/> when owned by this wrapper.</summary>
    public void Dispose()
    {
        if (_ownsClient)
            _httpClient.Dispose();
    }

    private static Uri BuildEndpoint(string serverUrl, string relativePath)
    {
        if (
            string.IsNullOrWhiteSpace(serverUrl)
            || !Uri.TryCreate(serverUrl.Trim(), UriKind.Absolute, out Uri? baseUri)
            || (baseUri.Scheme != Uri.UriSchemeHttp && baseUri.Scheme != Uri.UriSchemeHttps)
        )
        {
            throw new FacetValidationException("Enter an absolute HTTP or HTTPS Facet server URL.");
        }

        string normalized = baseUri.AbsoluteUri.TrimEnd('/');
        return new Uri(normalized + relativePath, UriKind.Absolute);
    }

    private static void AttachCredentials(HttpRequestMessage message, string? token)
    {
        message.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (!string.IsNullOrWhiteSpace(token))
        {
            message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.Trim());
        }
    }

    private async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage message,
        CancellationToken cancellationToken
    )
    {
        try
        {
            return await _httpClient
                .SendAsync(message, HttpCompletionOption.ResponseContentRead, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (HttpRequestException error)
        {
            throw new FacetNetworkException(
                "Could not reach the Facet server. Check your connection and server URL.",
                error
            );
        }
        catch (TaskCanceledException error) when (!cancellationToken.IsCancellationRequested)
        {
            throw new FacetNetworkException("The Facet server timed out before responding.", error);
        }
    }

    private static void EnsureSuccess(HttpStatusCode statusCode, string body)
    {
        int numeric = (int)statusCode;
        if (numeric is >= 200 and <= 299)
            return;

        string? serverDetail = TryExtractErrorMessage(body);
        if (statusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
        {
            throw new FacetAuthenticationException(
                serverDetail ?? "The Facet server rejected the configured API token.",
                (ushort)numeric
            );
        }

        throw new FacetApiException(
            serverDetail ?? $"The Facet server returned HTTP {numeric}.",
            (ushort)numeric
        );
    }

    private static string? TryExtractErrorMessage(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
            return null;
        try
        {
            using JsonDocument document = JsonDocument.Parse(body);
            JsonElement root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
                return null;
            if (
                root.TryGetProperty("error", out JsonElement errorProp)
                && errorProp.ValueKind == JsonValueKind.String
                && !string.IsNullOrWhiteSpace(errorProp.GetString())
            )
            {
                return errorProp.GetString();
            }
            if (
                root.TryGetProperty("message", out JsonElement messageProp)
                && messageProp.ValueKind == JsonValueKind.String
                && !string.IsNullOrWhiteSpace(messageProp.GetString())
            )
            {
                return messageProp.GetString();
            }
            return null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
