package com.shepherdjerred.thestorm.companions.adapter.http;

import com.shepherdjerred.thestorm.companions.app.CompanionGate;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import tools.jackson.databind.json.JsonMapper;

/** Fail-closed, asynchronous Flipt evaluation. */
public final class FliptCompanionGate implements CompanionGate {
  private final HttpClient client =
      HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
  private final URI endpoint;
  private final String environment;

  public FliptCompanionGate(URI base, String environment) {
    if ((!"http".equals(base.getScheme()) && !"https".equals(base.getScheme()))
        || base.getHost() == null
        || base.getUserInfo() != null
        || base.getQuery() != null)
      throw new IllegalArgumentException("invalid Flipt server address");
    if (!"prod".equals(environment) && !"beta".equals(environment))
      throw new IllegalArgumentException("invalid Flipt environment");
    endpoint = base.resolve("/evaluate/v1/boolean");
    this.environment = environment;
  }

  @Override
  public java.util.concurrent.CompletableFuture<Boolean> enabled() {
    var request =
        HttpRequest.newBuilder(endpoint)
            .timeout(Duration.ofSeconds(3))
            .header("Content-Type", "application/json")
            .header("x-flipt-environment", environment)
            .POST(
                HttpRequest.BodyPublishers.ofString(
                    "{\"namespace_key\":\"the-storm\",\"flag_key\":\"the-storm-companions-enabled\",\"entity_id\":\"the-storm-companions\",\"context\":{}}"))
            .build();
    return client
        .sendAsync(request, HttpResponse.BodyHandlers.ofString())
        .thenApply(
            response -> {
              if (response.statusCode() != 200)
                throw new IllegalStateException(
                    "companion flag returned HTTP " + response.statusCode());
              var enabled = JsonMapper.builder().build().readTree(response.body()).get("enabled");
              if (enabled == null || !enabled.isBoolean())
                throw new IllegalStateException("companion flag lacks a boolean value");
              return enabled.booleanValue();
            });
  }

  @Override
  public void close() {
    client.shutdownNow();
  }
}
