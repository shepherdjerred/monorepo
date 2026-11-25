package com.shepherdjerred.thestorm.rwf.adapter.remote;

import com.shepherdjerred.thestorm.core.expansion.FlagProviderUnavailableException;
import com.shepherdjerred.thestorm.core.flags.FlagsClient;
import com.shepherdjerred.thestorm.rwf.app.RwfFeatures;
import java.net.URI;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * Evaluates the managed Red Warfare feature flags, which are server-wide, without blocking Paper's
 * main thread: each is evaluated with the rwf map world as context. The identifiers are checked
 * against the shared flag inventory at build time.
 */
public final class FlagsRwfFeatures implements RwfFeatures.Source {

  private static final String MATCH_FLOW_FLAG_KEY = "the-storm-rwf-match-flow-enabled";
  private static final String CARRY_OVER_FLAG_KEY = "the-storm-rwf-carry-over-enabled";
  private static final String DEATH_FEED_FLAG_KEY = "the-storm-rwf-death-feed-enabled";
  private static final String TEAM_CHAT_FLAG_KEY = "the-storm-rwf-team-chat-enabled";
  private static final String SPECTATOR_TOOLS_FLAG_KEY = "the-storm-rwf-spectator-tools-enabled";
  private static final String BOMB_EFFECTS_FLAG_KEY = "the-storm-rwf-bomb-effects-enabled";
  private static final String STATS_FLAG_KEY = "the-storm-rwf-stats-enabled";
  private static final String HOST_SETTINGS_FLAG_KEY = "the-storm-rwf-host-settings-enabled";
  private static final String CANDIDATE_VISITS_FLAG_KEY = "the-storm-rwf-candidate-visits-enabled";

  private final FlagsClient client;
  private final String world;
  private volatile RwfFeatures lastKnown;

  /**
   * @param base the Flags server address
   * @param deployment the Flags deployment ({@code <catalog>/<stage>})
   * @param world the rwf map world, sent as evaluation context
   */
  public FlagsRwfFeatures(URI base, String deployment, String world) {
    this.client = new FlagsClient(base, deployment);
    this.world = world;
    var defaultOn = "prod".equals(client.stage());
    this.lastKnown =
        new RwfFeatures(false, false, false, false, false, false, false, defaultOn, defaultOn);
  }

  @Override
  public CompletableFuture<RwfFeatures> evaluate() {
    var previous = lastKnown;
    var flow = flag(MATCH_FLOW_FLAG_KEY, previous.matchFlow());
    var carry = flag(CARRY_OVER_FLAG_KEY, previous.carryOver());
    var feed = flag(DEATH_FEED_FLAG_KEY, previous.deathFeed());
    var chat = flag(TEAM_CHAT_FLAG_KEY, previous.teamChat());
    var spectate = flag(SPECTATOR_TOOLS_FLAG_KEY, previous.spectatorTools());
    var bombs = flag(BOMB_EFFECTS_FLAG_KEY, previous.bombEffects());
    var stats = flag(STATS_FLAG_KEY, previous.stats());
    var host = flag(HOST_SETTINGS_FLAG_KEY, previous.hostSettings());
    var visits = flag(CANDIDATE_VISITS_FLAG_KEY, previous.candidateVisits());
    return CompletableFuture.allOf(flow, carry, feed, chat, spectate, bombs, stats, host, visits)
        .thenApply(ignored -> {
          var resolved =
              new RwfFeatures(
                  flow.join(),
                  carry.join(),
                  feed.join(),
                  chat.join(),
                  spectate.join(),
                  bombs.join(),
                  stats.join(),
                  host.join(),
                  visits.join());
          lastKnown = resolved;
          return resolved;
        });
  }

  private CompletableFuture<Boolean> flag(String key, boolean fallback) {
    return client
        .evaluate(key, Map.of("world", world))
        .exceptionally(failure -> {
          var cause = FlagProviderUnavailableException.unwrap(failure);
          if ("prod".equals(client.stage()) && cause instanceof FlagProviderUnavailableException) {
            System.getLogger(FlagsRwfFeatures.class.getName())
                .log(
                    System.Logger.Level.WARNING,
                    "Flag provider unavailable; retaining the last value or declared default for {0}",
                    key);
            return fallback;
          }
          throw new java.util.concurrent.CompletionException(cause);
        });
  }

  @Override
  public void close() {
    client.close();
  }
}
