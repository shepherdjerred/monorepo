package com.shepherdjerred.thestorm.npcs.domain.movement;

/**
 * How NPCs walk.
 *
 * @param speed blocks per tick; 0.2 looks like walking, and more looks like sliding
 * @param arriveDistance how close counts as having arrived, in blocks
 * @param stuckTicks ticks without getting closer to the next waypoint before the NPC gives up and
 *     teleports to its destination
 * @param pathAttempts ticks to wait for the navigator to find a path before teleporting
 * @param maxReplans how many more paths to request when a path ends short of the destination
 * @param dwellMinTicks the shortest pause between wander or patrol legs
 * @param dwellMaxTicks the longest pause between wander or patrol legs
 */
public record MovementSettings(
    double speed,
    double arriveDistance,
    int stuckTicks,
    int pathAttempts,
    int maxReplans,
    int dwellMinTicks,
    int dwellMaxTicks) {

  /** The fastest step that still reads as walking. */
  public static final double MAX_SPEED = 0.2;

  public MovementSettings {
    if (!(speed > 0 && speed <= MAX_SPEED)) {
      throw new IllegalArgumentException("speed must be in (0, " + MAX_SPEED + "]: " + speed);
    }
    if (!(arriveDistance >= speed && arriveDistance <= 2)) {
      throw new IllegalArgumentException(
          "arriveDistance must be at least the speed and at most 2: " + arriveDistance);
    }
    if (stuckTicks < 1) {
      throw new IllegalArgumentException("stuckTicks must be positive: " + stuckTicks);
    }
    if (pathAttempts < 1) {
      throw new IllegalArgumentException("pathAttempts must be positive: " + pathAttempts);
    }
    if (maxReplans < 0) {
      throw new IllegalArgumentException("maxReplans must not be negative: " + maxReplans);
    }
    if (dwellMinTicks < 0 || dwellMaxTicks < dwellMinTicks) {
      throw new IllegalArgumentException(
          "need 0 <= dwellMinTicks <= dwellMaxTicks: " + dwellMinTicks + ", " + dwellMaxTicks);
    }
  }
}
