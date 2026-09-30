package com.shepherdjerred.thestorm.npcs.domain.movement;

import com.shepherdjerred.thestorm.npcs.domain.brain.Intent;
import com.shepherdjerred.thestorm.npcs.domain.geo.Vec3;
import java.util.List;
import java.util.Optional;

/**
 * One NPC's movement state.
 *
 * @param intent what it is doing
 * @param stop the patrol stop it is heading to or resting at; 0 for other intents
 * @param phase where it is in getting there
 */
public record Walker(Intent intent, int stop, Phase phase) {

  /** Where the NPC is in reaching its current destination. */
  public sealed interface Phase {

    /** At the destination until {@code until} (a tick; {@link Long#MAX_VALUE} for good). */
    record Resting(long until) implements Phase {}

    /**
     * Waiting for the navigator to find a path to {@code target}.
     *
     * @param attempts ticks already spent waiting
     * @param replans paths already requested after earlier ones fell short
     */
    record Planning(Vec3 target, int attempts, int replans) implements Phase {}

    /**
     * Walking {@code waypoints} towards {@code target}.
     *
     * @param next the index of the waypoint being walked to
     * @param best the closest the NPC has been to that waypoint
     * @param progressAt the tick it last got closer
     * @param replans paths already requested after earlier ones fell short
     */
    record Following(
        Vec3 target, List<Vec3> waypoints, int next, double best, long progressAt, int replans)
        implements Phase {

      public Following {
        waypoints = List.copyOf(waypoints);
        if (next < 0 || next >= waypoints.size()) {
          throw new IllegalArgumentException(
              "waypoint " + next + " of " + waypoints.size() + " does not exist");
        }
      }
    }
  }

  /** The destination the navigator should find a path to, while one is wanted. */
  public Optional<Vec3> pathTarget() {
    return phase instanceof Phase.Planning(var target, var _, var _)
        ? Optional.of(target)
        : Optional.empty();
  }

  /** Whether the NPC is on its way somewhere, as opposed to resting. */
  public boolean moving() {
    return !(phase instanceof Phase.Resting);
  }
}
