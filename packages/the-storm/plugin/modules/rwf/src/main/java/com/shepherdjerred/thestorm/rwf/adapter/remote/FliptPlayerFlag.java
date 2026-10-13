package com.shepherdjerred.thestorm.rwf.adapter.remote;

import com.shepherdjerred.thestorm.rwf.app.JoinGate;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * One managed Flipt boolean flag evaluated per player without blocking Paper's main thread, with
 * the rwf world as evaluation context. Each flag's identifiers live in its own class ({@link
 * FliptRwfKitsGate}, {@link FliptRwfKillstreaksGate}), checked against the shared flag inventory at
 * build time.
 */
public final class FliptPlayerFlag implements JoinGate, AutoCloseable {

  private final HttpClient client;
  private final URI endpoint;
  private final String environment;
  private final String world;
  private final String namespace;
  private final String flag;

  /**
   * Which flag.
   *
   * @param namespace the Flipt namespace
   * @param flag the flag key
   */
  record Key(String namespace, String flag) {}

  FliptPlayerFlag(URI base, String environment, String world, Key key) {
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
    this.namespace = key.namespace();
    this.flag = key.flag();
  }

  /** The flag key, for logs. */
  public String flag() {
    return flag;
  }

  @Override
  public CompletableFuture<Boolean> allows(UUID player) {
    var body =
        "{\"namespace_key\":\""
            + namespace
            + "\",\"flag_key\":\""
            + flag
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

  @Override
  public void close() {
    client.close();
  }
}
