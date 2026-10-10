package com.shepherdjerred.thestorm.core.analytics;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import tools.jackson.databind.json.JsonMapper;

final class PostHogTransport implements AnalyticsTransport {
  private final AnalyticsBootstrap bootstrap;
  private final JsonMapper json = JsonMapper.builder().build();
  private final HttpClient client =
      HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();

  PostHogTransport(AnalyticsBootstrap bootstrap) {
    this.bootstrap = bootstrap;
  }

  @Override
  public CompletableFuture<Void> send(List<AnalyticsStore.Pending> batch) {
    var body =
        json.writeValueAsString(
            Map.of(
                "api_key",
                bootstrap.projectToken(),
                "batch",
                batch.stream().map(event -> json.readTree(event.payload())).toList()));
    var request =
        HttpRequest.newBuilder(bootstrap.host().resolve("/batch/"))
            .timeout(Duration.ofSeconds(5))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();
    return client
        .sendAsync(request, HttpResponse.BodyHandlers.discarding())
        .thenAccept(
            response -> {
              if (response.statusCode() != 200)
                throw new IllegalStateException(
                    "PostHog capture returned HTTP " + response.statusCode());
            });
  }

  @Override
  public void close() {
    client.shutdownNow();
  }
}
