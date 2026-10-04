package com.shepherdjerred.thestorm.rwfbots.domain.perception;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * One bot's memory of enemies: the last sighting of each, whose confidence decays as {@code exp(-dt
 * / tau)} until it drops below {@link #FORGET_BELOW} and is pruned.
 *
 * @param sightings the last sighting by enemy
 */
public record Memory(Map<CombatantId, Sighting> sightings) {

  public static final Memory EMPTY = new Memory(Map.of());

  /** Sightings whose confidence has decayed under this are dropped. */
  public static final double FORGET_BELOW = 0.05;

  public Memory {
    sightings = Map.copyOf(sightings);
  }

  public Optional<Sighting> of(CombatantId enemy) {
    return Optional.ofNullable(sightings.get(enemy));
  }

  /** The decayed confidence in {@code enemy}'s sighting at {@code now}; 0 when unknown. */
  public double confidence(CombatantId enemy, long now, double tauTicks) {
    var sighting = sightings.get(enemy);
    return sighting == null ? 0 : sighting.confidenceAt(now, tauTicks);
  }

  /**
   * This memory with {@code sighting} for {@code enemy}, unless the existing sighting is newer, or
   * as new and at least as confident.
   */
  public Memory remember(CombatantId enemy, Sighting sighting) {
    var existing = sightings.get(enemy);
    if (existing != null && !supersedes(sighting, existing)) {
      return this;
    }
    var copy = new HashMap<>(sightings);
    copy.put(enemy, sighting);
    return new Memory(copy);
  }

  private static boolean supersedes(Sighting candidate, Sighting existing) {
    if (candidate.tick() != existing.tick()) {
      return candidate.tick() > existing.tick();
    }
    return candidate.confidence() > existing.confidence();
  }

  public Memory forget(CombatantId enemy) {
    if (!sightings.containsKey(enemy)) {
      return this;
    }
    var copy = new HashMap<>(sightings);
    copy.remove(enemy);
    return new Memory(copy);
  }

  /** This memory without sightings decayed below {@link #FORGET_BELOW} at {@code now}. */
  public Memory prune(long now, double tauTicks) {
    var copy = new HashMap<CombatantId, Sighting>();
    sightings.forEach(
        (enemy, sighting) -> {
          if (sighting.confidenceAt(now, tauTicks) >= FORGET_BELOW) {
            copy.put(enemy, sighting);
          }
        });
    return copy.size() == sightings.size() ? this : new Memory(copy);
  }
}
