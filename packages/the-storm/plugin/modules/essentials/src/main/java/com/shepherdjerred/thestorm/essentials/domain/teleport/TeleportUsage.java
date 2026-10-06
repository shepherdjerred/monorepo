package com.shepherdjerred.thestorm.essentials.domain.teleport;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** Successful trips and a single player-wide cooldown, including across restarts. */
public record TeleportUsage(List<TeleportUse> trips, Instant cooldownUntil) {
  public static final TeleportUsage EMPTY = new TeleportUsage(List.of(), Instant.EPOCH);

  public TeleportUsage {
    trips = List.copyOf(trips);
  }

  public List<TeleportUse> active(Duration window, Instant now) {
    var cutoff = now.minus(window);
    return trips.stream().filter(trip -> trip.at().isAfter(cutoff)).toList();
  }

  /** Rebase the proposed trip and its cooldown on actual successful arrival. */
  public TeleportUsage deliveredAt(Instant now) {
    var proposed = trips.getLast();
    var cooldown = Duration.between(proposed.at(), cooldownUntil);
    var delivered = new ArrayList<>(trips);
    delivered.set(delivered.size() - 1, new TeleportUse(now, proposed.halfPoints()));
    return new TeleportUsage(delivered, now.plus(cooldown));
  }
}
