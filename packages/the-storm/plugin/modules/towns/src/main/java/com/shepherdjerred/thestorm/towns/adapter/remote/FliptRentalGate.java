package com.shepherdjerred.thestorm.towns.adapter.remote;

import com.shepherdjerred.thestorm.towns.app.RentalGate;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import tools.jackson.databind.json.JsonMapper;

/** Per-admission boolean evaluation using the same Flipt bootstrap as the world module. */
public final class FliptRentalGate implements RentalGate, AutoCloseable {
  public static final String FLAG_KEY = "the-storm-shop-rentals-enabled";
  private static final JsonMapper JSON = JsonMapper.builder().build();
  private final HttpClient client;
  private final URI endpoint;
  private final String environment;

  public FliptRentalGate(URI base, String environment) {
    if ((!"http".equals(base.getScheme()) && !"https".equals(base.getScheme()))
        || base.getHost() == null
        || base.getUserInfo() != null
        || base.getQuery() != null
        || (!"prod".equals(environment) && !"beta".equals(environment))) {
      throw new IllegalArgumentException("invalid Flipt bootstrap address or environment");
    }
    endpoint = base.resolve("/evaluate/v1/boolean");
    client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    this.environment = environment;
  }

  @Override
  public CompletableFuture<Boolean> enabled(UUID player) {
    var request =
        HttpRequest.newBuilder(endpoint)
            .timeout(Duration.ofSeconds(3))
            .header("Content-Type", "application/json")
            .header("x-flipt-environment", environment)
            .POST(
                HttpRequest.BodyPublishers.ofString(
                    "{\"namespace_key\":\"the-storm\",\"flag_key\":\""
                        + FLAG_KEY
                        + "\",\"entity_id\":\""
                        + player
                        + "\",\"context\":{\"world\":\"world\"}}"))
            .build();
    return client
        .sendAsync(request, HttpResponse.BodyHandlers.ofString())
        .thenApply(
            response -> {
              if (response.statusCode() != 200) {
                throw new IllegalStateException(
                    "rental flag evaluation returned HTTP " + response.statusCode());
              }
              var root = JSON.readTree(response.body());
              var enabled = root.get("enabled");
              if (enabled == null || !enabled.isBoolean()) {
                throw new IllegalStateException(
                    "rental flag evaluation is missing a boolean enabled field");
              }
              return enabled.booleanValue();
            });
  }

  @Override
  public void close() {
    client.close();
  }
}
