package com.shepherdjerred.thestorm.stats.adapter.http;

import com.shepherdjerred.thestorm.stats.app.StatsTransport;
import com.shepherdjerred.thestorm.stats.app.StatsWire;
import java.io.IOException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import tools.jackson.databind.json.JsonMapper;

/** Sends {@link StatsWire.IngestBatch} JSON over HTTP using an owned virtual-thread executor. */
public final class HttpStatsTransport implements StatsTransport {

  private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);
  private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);

  private final StatsEndpoint endpoint;
  private final JsonMapper json = JsonMapper.builder().build();
  private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
  private final HttpClient client =
      HttpClient.newBuilder().executor(executor).connectTimeout(CONNECT_TIMEOUT).build();

  public HttpStatsTransport(StatsEndpoint endpoint) {
    this.endpoint = endpoint;
  }

  @Override
  public CompletableFuture<Void> send(StatsWire.IngestBatch batch) {
    var payload = json.writeValueAsString(batch);
    var request =
        HttpRequest.newBuilder(endpoint.ingestUri())
            .timeout(REQUEST_TIMEOUT)
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer " + endpoint.bearerToken())
            .POST(HttpRequest.BodyPublishers.ofString(payload))
            .build();
    return CompletableFuture.runAsync(() -> execute(request), executor);
  }

  private void execute(HttpRequest request) {
    try {
      var response = client.send(request, HttpResponse.BodyHandlers.discarding());
      if (response.statusCode() != 200) {
        throw new IllegalStateException(
            "storm-stats ingest returned HTTP " + response.statusCode());
      }
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("storm-stats ingest interrupted", interrupted);
    } catch (IOException failure) {
      throw new IllegalStateException(
          "storm-stats ingest failed: " + failure.getMessage(), failure);
    }
  }

  @Override
  public void close() {
    client.shutdownNow();
    executor.close();
  }
}
