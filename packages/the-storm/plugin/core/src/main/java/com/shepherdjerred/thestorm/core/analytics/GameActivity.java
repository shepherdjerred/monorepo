package com.shepherdjerred.thestorm.core.analytics;

import java.util.Collection;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/** Records accepted game membership, including lobby and spectating, once per transition. */
public final class GameActivity {
  private final ProductAnalytics analytics;
  private final ProductAnalytics.Mode mode;
  private final Set<UUID> members = new HashSet<>();

  public GameActivity(ProductAnalytics analytics, ProductAnalytics.Mode mode) {
    if (mode == ProductAnalytics.Mode.SURVIVAL)
      throw new IllegalArgumentException("Game mode required");
    this.analytics = analytics;
    this.mode = mode;
  }

  public void joined(UUID player) {
    if (members.add(player)) {
      analytics.mode(player, mode);
      analytics.interaction(
          player, action(ProductAnalytics.Action.ARENA_JOINED, ProductAnalytics.Action.RWF_JOINED));
    }
  }

  public void started(Collection<UUID> players) {
    players.stream()
        .filter(members::contains)
        .forEach(
            player ->
                analytics.interaction(
                    player,
                    action(
                        ProductAnalytics.Action.ARENA_STARTED,
                        ProductAnalytics.Action.RWF_STARTED)));
  }

  /** A run ended, including a forced stop. Individual departures are recorded separately. */
  public void completed(Collection<UUID> players) {
    players.stream()
        .filter(members::contains)
        .forEach(
            player ->
                analytics.interaction(
                    player,
                    action(
                        ProductAnalytics.Action.ARENA_COMPLETED,
                        ProductAnalytics.Action.RWF_COMPLETED)));
  }

  public void left(UUID player) {
    if (members.remove(player)) {
      analytics.interaction(
          player, action(ProductAnalytics.Action.ARENA_LEFT, ProductAnalytics.Action.RWF_LEFT));
      analytics.mode(player, ProductAnalytics.Mode.SURVIVAL);
    }
  }

  private ProductAnalytics.Action action(
      ProductAnalytics.Action arena, ProductAnalytics.Action rwf) {
    return mode == ProductAnalytics.Mode.ARENA ? arena : rwf;
  }
}
