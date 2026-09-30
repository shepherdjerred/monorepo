package com.shepherdjerred.thestorm.qol.app;

import com.shepherdjerred.thestorm.qol.domain.combat.CombatTags;
import java.time.Duration;
import java.time.InstantSource;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Stream;

/** The current combat tags. Main thread only. */
public final class CombatTracker implements CombatStatus {

  private final InstantSource time;
  private final Duration length;
  private CombatTags tags = CombatTags.none();

  public CombatTracker(InstantSource time, Duration length) {
    this.time = time;
    this.length = length;
  }

  /**
   * {@code attacker} hit {@code victim}; both are tagged. Returns the players who were not in
   * combat before this hit.
   */
  public List<UUID> hit(UUID attacker, UUID victim) {
    var now = time.instant();
    if (attacker.equals(victim)) {
      return List.of();
    }
    var fresh = Stream.of(attacker, victim).filter(p -> !tags.isTagged(p, now)).toList();
    tags = tags.hit(attacker, victim, now, length);
    return fresh;
  }

  @Override
  public Optional<Duration> remaining(UUID player) {
    return tags.remaining(player, time.instant());
  }

  /** {@code player} is out of combat (they died or left). */
  public void clear(UUID player) {
    tags = tags.clear(player);
  }

  /** Drops ended tags; returns the players whose tags just ended. */
  public List<UUID> sweep() {
    var swept = tags.sweep(time.instant());
    tags = swept.tags();
    return swept.ended();
  }

  /** Everyone tagged right now. */
  public List<UUID> tagged() {
    var now = time.instant();
    return tags.until().keySet().stream().filter(p -> tags.isTagged(p, now)).sorted().toList();
  }

  /** Forgets every tag (the module is stopping). */
  public void clearAll() {
    tags = CombatTags.none();
  }
}
