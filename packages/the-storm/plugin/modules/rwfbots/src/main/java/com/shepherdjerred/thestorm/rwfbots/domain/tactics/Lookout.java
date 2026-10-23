package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static java.util.Comparator.comparingLong;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Sighting;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import java.util.Map;
import java.util.Optional;

/**
 * Where a holding bot looks. A visible enemy draws its eye at any range, and the spot one was last
 * seen holds it for {@link #LINGER_TICKS} after. Holders used to keep staring at their slot's angle
 * until an enemy came within contact range: in production a bot first faced an approaching human at
 * a median 20.5 blocks, and in a third of approaches not before 8.
 */
final class Lookout {

  /** How long the spot an enemy was last seen keeps the bot's eye, in ticks (2 s). */
  static final long LINGER_TICKS = 40;

  private Lookout() {}

  /**
   * The point to watch: the nearest visible enemy, a fresh last sighting, else {@code fallback}.
   */
  static Vec3 watch(Situation situation, Vec3 fallback) {
    return situation
        .percept()
        .nearestVisible()
        .map(CombatantView::pos)
        .or(() -> lastSeen(situation))
        .orElse(fallback);
  }

  /** Whether the bot is still watching where an enemy it saw a moment ago went. */
  static boolean lingering(Situation situation) {
    return situation.percept().nearestVisible().isEmpty() && lastSeen(situation).isPresent();
  }

  /** Where a living enemy was last seen, if that was within {@link #LINGER_TICKS}. */
  private static Optional<Vec3> lastSeen(Situation situation) {
    var now = situation.now();
    return situation.percept().state().memory().sightings().entrySet().stream()
        .filter(entry -> entry.getValue().direct() && now - entry.getValue().tick() <= LINGER_TICKS)
        .filter(entry -> alive(situation, entry.getKey()))
        .max(
            comparingLong((Map.Entry<CombatantId, Sighting> entry) -> entry.getValue().tick())
                .thenComparing(Map.Entry::getKey))
        .map(entry -> entry.getValue().pos());
  }

  private static boolean alive(Situation situation, CombatantId id) {
    return situation.snapshot().combatant(id).map(CombatantView::alive).orElse(false);
  }
}
