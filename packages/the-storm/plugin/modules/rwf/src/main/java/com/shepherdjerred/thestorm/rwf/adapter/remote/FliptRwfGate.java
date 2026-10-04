package com.shepherdjerred.thestorm.rwf.adapter.remote;

import com.shepherdjerred.thestorm.rwf.app.JoinGate;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import tools.jackson.databind.json.JsonMapper;

/**
 * Evaluates the managed {@code the-storm-rwf-enabled} flag for one player without blocking Paper's
 * main thread. The identifiers are checked against the shared flag inventory at build time.
 */
public final class FliptRwfGate implements JoinGate, AutoCloseable {

  private static final JsonMapper JSON = JsonMapper.builder().build();
  private static final String NAMESPACE_KEY = "the-storm";
  private static final String FLAG_KEY = "the-storm-rwf-enabled";

  private final HttpClient client;
  private final URI endpoint;
  private final String environment;
  private final String world;

  /**
   * @param base the Flipt server address
   * @param environment {@code prod} or {@code beta}
   * @param world the rwf world, sent as evaluation context
   */
  public FliptRwfGate(URI base, String environment, String world) {
    if (!"http".equals(base.getScheme()) && !"https".equals(base.getScheme())) {
      throw new IllegalArgumentException("Flipt URL must use HTTP or HTTPS");
    }
    if (base.getHost() == null || base.getUserInfo() != null || base.getQuery() != null) {
      throw new IllegalArgumentException("Flipt URL must be an uncredentialed server address");
    }
    if (!"prod".equals(environment) && !"beta".equals(environment)) {
      throw new IllegalArgumentException("unknown Flipt environment: " + environment);
    }
    this.endpoint = base.resolve("/evaluate/v1/boolean");
    this.client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    this.environment = environment;
    this.world = world;
  }

  @Override
  public CompletableFuture<Boolean> allows(UUID player) {
    var body =
        "{\"namespace_key\":\""
            + NAMESPACE_KEY
            + "\",\"flag_key\":\""
            + FLAG_KEY
            + "\",\"entity_id\":\""
            + player
            + "\",\"context\":{\"world\":\""
            + world
            + "\"}}";
    var request =
        HttpRequest.newBuilder(endpoint)
            .timeout(Duration.ofSeconds(3))
            .header("Content-Type", "application/json")
            .header("x-flipt-environment", environment)
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();
    return client
        .sendAsync(request, HttpResponse.BodyHandlers.ofString())
        .thenApply(FliptRwfGate::parse);
  }

  static boolean parse(HttpResponse<String> response) {
    if (response.statusCode() != 200) {
      throw new IllegalStateException("Flipt evaluation returned HTTP " + response.statusCode());
    }
    var root = JSON.readTree(response.body());
    var enabled = root.get("enabled");
    if (enabled == null || !enabled.isBoolean()) {
      throw new IllegalStateException("Flipt boolean evaluation is missing enabled");
    }
    return enabled.booleanValue();
  }

  @Override
  public void close() {
    client.close();
  }
}
