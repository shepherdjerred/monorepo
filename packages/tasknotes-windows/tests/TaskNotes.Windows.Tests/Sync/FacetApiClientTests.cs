using System.Net;
using System.Text.Json;
using TaskNotes.Protocol;
using TaskNotes.Windows.Host;
using Task = System.Threading.Tasks.Task;

namespace TaskNotes.Windows.Tests;

/// <summary>Verifies HTTP transport, Bearer auth, protocol JSON serialization, and typed error mapping.</summary>
[TestClass]
public sealed class FacetApiClientTests
{
    /// <summary>Gets or sets the MSTest execution context.</summary>
    public required TestContext TestContext { get; set; }

    /// <summary>Serializes SyncRequest with snake_case protocol keys, attaches Bearer auth, and parses SyncResponse.</summary>
    [TestMethod]
    public async Task SyncAsyncSendsBearerTokenAndProtocolPayload()
    {
        RecordingHttpHandler handler = new()
        {
            Responder = static (_, _) =>
                System.Threading.Tasks.Task.FromResult(
                    RecordingHttpHandler.JsonResponse(
                        HttpStatusCode.OK,
                        JsonSerializer.Serialize(
                            ProtocolTestFactory.EmptySyncResponse(
                                syncToken: "seq:42",
                                fullSync: false,
                                tempIdMapping: new Dictionary<string, string>(
                                    StringComparer.Ordinal
                                )
                                {
                                    ["tmp-1"] = "real-1",
                                },
                                syncStatus: new Dictionary<string, string>(StringComparer.Ordinal)
                                {
                                    ["cmd-1"] = "ok",
                                }
                            ),
                            FacetProtocolJson.Options
                        )
                    )
                ),
        };
        using HttpClient http = new(handler);
        using FacetApiClient client = new(http, ownsClient: false);

        SyncRequest request = new(
            SyncToken: "seq:41",
            ResourceTypes: ["all"],
            Commands:
            [
                new QueuedCommand(
                    "cmd-1",
                    "tmp-1",
                    new SyncCommand.TaskAdd(new TaskAddArgs(ProjectId: "inbox", Title: "Ship"))
                ),
            ]
        );
        SyncResponse response = await client.SyncAsync(
            "https://facet.example/subpath/",
            " secret-token ",
            request,
            TestContext.CancellationToken
        );

        Assert.AreEqual("seq:42", response.SyncToken);
        Assert.AreEqual("real-1", response.TempIdMapping["tmp-1"]);
        CapturedHttpRequest captured = handler.Requests.Single();
        Assert.AreEqual(HttpMethod.Post, captured.Method);
        Assert.AreEqual("https://facet.example/subpath/api/v1/sync", captured.Uri.AbsoluteUri);
        Assert.AreEqual("Bearer", captured.AuthScheme);
        Assert.AreEqual("secret-token", captured.AuthParameter);
        StringAssert.Contains(captured.Body, "\"sync_token\":\"seq:41\"", StringComparison.Ordinal);
        StringAssert.Contains(captured.Body, "\"type\":\"TaskAdd\"", StringComparison.Ordinal);
    }

    /// <summary>Classifies 401/403, 500, malformed JSON, network failures, timeouts, and invalid URLs.</summary>
    [TestMethod]
    public async Task SyncAsyncAndCheckHealthAsyncClassifyAllBoundaryFailures()
    {
        RecordingHttpHandler handler = new();
        using HttpClient ownedHttp = new(handler);
        FacetApiClient client = new(ownedHttp, ownsClient: true);

        SyncRequest emptyRequest = new("*", null, []);
        _ = await Assert.ThrowsExactlyAsync<FacetValidationException>(() =>
            client.SyncAsync("", null, emptyRequest, TestContext.CancellationToken)
        );
        _ = await Assert.ThrowsExactlyAsync<FacetValidationException>(() =>
            client.SyncAsync("ftp://bad.example", null, emptyRequest, TestContext.CancellationToken)
        );

        handler.Responder = static (_, _) =>
            Task.FromResult(
                RecordingHttpHandler.JsonResponse(
                    HttpStatusCode.Unauthorized,
                    """{"error":"Invalid API token"}"""
                )
            );
        FacetAuthenticationException auth =
            await Assert.ThrowsExactlyAsync<FacetAuthenticationException>(() =>
                client.SyncAsync(
                    "https://facet.example",
                    "wrong",
                    emptyRequest,
                    TestContext.CancellationToken
                )
            );
        Assert.AreEqual((ushort)401, auth.StatusCode);
        Assert.AreEqual("Invalid API token", auth.Message);

        handler.Responder = static (_, _) =>
            Task.FromResult(
                RecordingHttpHandler.JsonResponse(
                    HttpStatusCode.ServiceUnavailable,
                    """{"message":"Upstream maintenance"}"""
                )
            );
        FacetApiException serverError = await Assert.ThrowsExactlyAsync<FacetApiException>(() =>
            client.SyncAsync(
                "https://facet.example",
                null,
                emptyRequest,
                TestContext.CancellationToken
            )
        );
        Assert.AreEqual((ushort)503, serverError.StatusCode);
        Assert.AreEqual("Upstream maintenance", serverError.Message);

        handler.Responder = static (_, _) =>
            Task.FromResult(RecordingHttpHandler.JsonResponse(HttpStatusCode.OK, "not-json"));
        _ = await Assert.ThrowsExactlyAsync<FacetApiException>(() =>
            client.SyncAsync(
                "https://facet.example",
                null,
                emptyRequest,
                TestContext.CancellationToken
            )
        );
        _ = await Assert.ThrowsExactlyAsync<FacetApiException>(() =>
            client.CheckHealthAsync("https://facet.example", null, TestContext.CancellationToken)
        );

        handler.Responder = static (_, _) => throw new HttpRequestException("Connection refused");
        _ = await Assert.ThrowsExactlyAsync<FacetNetworkException>(() =>
            client.SyncAsync(
                "https://facet.example",
                null,
                emptyRequest,
                TestContext.CancellationToken
            )
        );

        handler.Responder = static (_, _) => throw new TaskCanceledException("Timed out");
        _ = await Assert.ThrowsExactlyAsync<FacetNetworkException>(() =>
            client.CheckHealthAsync("https://facet.example", null, TestContext.CancellationToken)
        );

        handler.Responder = static (_, _) =>
            System.Threading.Tasks.Task.FromResult(
                RecordingHttpHandler.JsonResponse(
                    HttpStatusCode.OK,
                    """{"success":true,"data":{"status":"ok","authenticated":true}}"""
                )
            );
        FacetHealthStatus wrappedHealth = await client.CheckHealthAsync(
            "https://facet.example",
            "tok",
            TestContext.CancellationToken
        );
        Assert.AreEqual(new FacetHealthStatus(true, true), wrappedHealth);

        handler.Responder = static (_, _) =>
            System.Threading.Tasks.Task.FromResult(
                RecordingHttpHandler.JsonResponse(HttpStatusCode.OK, """{"status":"ok"}""")
            );
        FacetHealthStatus directHealth = await client.CheckHealthAsync(
            "https://facet.example",
            null,
            TestContext.CancellationToken
        );
        Assert.AreEqual(new FacetHealthStatus(true, false), directHealth);

        client.Dispose();
        Assert.IsTrue(handler.Disposed);
    }
}
