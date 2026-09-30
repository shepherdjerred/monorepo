package com.shepherdjerred.thestorm.messages.domain;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Hides a player's death broadcasts once they die too often. When a death brings a player's deaths
 * within the trailing {@code window} above {@code maxDeaths}, that death and every later one are
 * hidden until the player goes quiet: a full window without dying. Hidden deaths still count toward
 * the window.
 *
 * <p>A death exactly {@code window} ago has left the window.
 *
 * @param maxDeaths deaths announced before hiding starts; at least 1
 * @param window the trailing window, and the quiet period that ends hiding; positive
 * @param players each player whose deaths are still inside the window
 */
public record DeathSpamLimiter(int maxDeaths, Duration window, Map<UUID, Streak> players) {

  public DeathSpamLimiter {
    if (maxDeaths < 1) {
      throw new IllegalArgumentException("maxDeaths must be at least 1: " + maxDeaths);
    }
    if (window.isNegative() || window.isZero()) {
      throw new IllegalArgumentException("window must be positive: " + window);
    }
    players = Map.copyOf(players);
  }

  /** A limiter that has seen no deaths. */
  public static DeathSpamLimiter of(int maxDeaths, Duration window) {
    return new DeathSpamLimiter(maxDeaths, window, Map.of());
  }

  /** Records that {@code player} died {@code at}, and whether to announce it. */
  public Verdict record(UUID player, Instant at) {
    var cutoff = at.minus(window);
    var next = new HashMap<UUID, Streak>();
    players.forEach(
        (id, streak) -> {
          var kept = streak.deaths().stream().filter(death -> death.isAfter(cutoff)).toList();
          if (!kept.isEmpty()) {
            next.put(id, new Streak(kept, streak.hidden()));
          }
        });
    // Absent means quiet for a full window, which also ends any hiding.
    var previous = next.getOrDefault(player, new Streak(List.of(), false));
    var deaths = new ArrayList<>(previous.deaths());
    deaths.add(at);
    var hidden = previous.hidden() || deaths.size() > maxDeaths;
    next.put(player, new Streak(deaths, hidden));
    return new Verdict(!hidden, new DeathSpamLimiter(maxDeaths, window, next));
  }

  /**
   * One player's recent deaths.
   *
   * @param deaths deaths still inside the window, oldest first
   * @param hidden whether their deaths are currently hidden
   */
  public record Streak(List<Instant> deaths, boolean hidden) {

    public Streak {
      deaths = List.copyOf(deaths);
    }
  }

  /**
   * The outcome of one death.
   *
   * @param announce whether to broadcast the death message
   * @param next the limiter state including this death
   */
  public record Verdict(boolean announce, DeathSpamLimiter next) {}
}
