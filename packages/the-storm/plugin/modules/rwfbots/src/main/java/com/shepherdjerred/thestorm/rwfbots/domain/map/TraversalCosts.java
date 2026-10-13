package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementMotor;

/** Server-tick costs calibrated against the native Citizens motor; damage uses health points. */
public final class TraversalCosts {
  public static final int MODEL_VERSION = 3;
  public static final float WALK = (float) (1 / MovementMotor.WALK_SPEED);
  public static final float DIAGONAL = WALK * 1.41421f;
  public static final float STEP_JUMP = 8;
  public static final float CLIMB = 5;
  public static final float SWIM_VERTICAL = 6.25f;

  private TraversalCosts() {}

  /** Converts former walk-block tolerances/tolls into their equivalent measured time units. */
  public static double walkingTicks(double blocks) {
    return blocks * WALK;
  }

  public static float swim(BlockPos from, BlockPos to) {
    return (float)
        Math.max(
            from.feet().horizontalDistance(to.feet()) / MovementMotor.WALK_SPEED,
            Math.abs(from.y() - to.y()) * SWIM_VERTICAL);
  }

  public static float drop(int depth) {
    return drop(depth, 0.08);
  }

  /** Slow Falling changes gravity, so its conservative ETA must change as well as damage. */
  public static float slowDrop(int depth) {
    return drop(depth, 0.01);
  }

  private static float drop(int depth, double gravity) {
    if (depth < 1) throw new IllegalArgumentException("drop depth must be positive");
    var height = 0.0;
    var velocity = 0.0;
    var ticks = 0;
    // This recurrence reproduces the native10-tick four-block and15-tick eight-block falls.
    while (-height < depth) {
      velocity = (velocity - gravity) * 0.98;
      height += velocity;
      ticks++;
    }
    return ticks + WALK;
  }

  /** Bound includes the jump apex; water landing is handled by the baker before this call. */
  public static int fallDamage(int depth, boolean jumped) {
    return Math.max(0, depth - (jumped ? 1 : 3));
  }
}
