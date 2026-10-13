package com.shepherdjerred.thestorm.rwf.adapter.remote;

import com.shepherdjerred.thestorm.rwf.app.RwfFeatures;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;

/**
 * Evaluates the managed Red Warfare feature flags, which are server-wide, without blocking Paper's
 * main thread: each is evaluated for one fixed entity with the rwf map world as context. The
 * identifiers are checked against the shared flag inventory at build time.
 */
public final class FliptRwfFeatures implements RwfFeatures.Source {

  private static final String NAMESPACE_KEY = "the-storm";
  private static final String MATCH_FLOW_FLAG_KEY = "the-storm-rwf-match-flow-enabled";
  private static final String CARRY_OVER_FLAG_KEY = "the-storm-rwf-carry-over-enabled";
  private static final String DEATH_FEED_FLAG_KEY = "the-storm-rwf-death-feed-enabled";
  private static final String TEAM_CHAT_FLAG_KEY = "the-storm-rwf-team-chat-enabled";
  private static final String SPECTATOR_TOOLS_FLAG_KEY = "the-storm-rwf-spectator-tools-enabled";
  private static final String BOMB_EFFECTS_FLAG_KEY = "the-storm-rwf-bomb-effects-enabled";
  private static final String STATS_FLAG_KEY = "the-storm-rwf-stats-enabled";
  private static final String ENTITY_ID = "the-storm-rwf-features";

  private final HttpClient client;
  private final URI endpoint;
  private final String environment;
  private final String world;

  /**
   * @param base the Flipt server address
   * @param environment {@code prod} or {@code beta}
   * @param world the rwf map world, sent as evaluation context
   */
  public FliptRwfFeatures(URI base, String environment, String world) {
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
  public CompletableFuture<RwfFeatures> evaluate() {
    var flow = flag(MATCH_FLOW_FLAG_KEY);
    var carry = flag(CARRY_OVER_FLAG_KEY);
    var feed = flag(DEATH_FEED_FLAG_KEY);
    var chat = flag(TEAM_CHAT_FLAG_KEY);
    var spectate = flag(SPECTATOR_TOOLS_FLAG_KEY);
    var bombs = flag(BOMB_EFFECTS_FLAG_KEY);
    var stats = flag(STATS_FLAG_KEY);
    return CompletableFuture.allOf(flow, carry, feed, chat, spectate, bombs, stats)
        .thenApply(
            ignored ->
                new RwfFeatures(
                    flow.join(),
                    carry.join(),
                    feed.join(),
                    chat.join(),
                    spectate.join(),
                    bombs.join(),
                    stats.join()));
  }

  private CompletableFuture<Boolean> flag(String key) {
    var body =
        "{\"namespace_key\":\""
            + NAMESPACE_KEY
            + "\",\"flag_key\":\""
            + key
            + "\",\"entity_id\":\""
            + ENTITY_ID
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
