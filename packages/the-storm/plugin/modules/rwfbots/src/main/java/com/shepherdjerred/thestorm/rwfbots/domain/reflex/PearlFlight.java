package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import java.util.Optional;

/**
 * Where a thrown ender pearl comes down, and so where its thrower lands. A pearl leaves the eye
 * {@link #SPEED} blocks a tick along the look, then every tick moves, loses {@link #DRAG} of its
 * speed and falls {@link #GRAVITY} faster; the first block it touches ends the flight and the
 * thrower is put where it touched. A landing is safe only on the top face of a block that bears
 * weight, with room to stand above it, inside the map; a pearl that strikes a wall, a ceiling or
 * nothing at all (the void) is no landing.
 */
public final class PearlFlight {

  /** The pearl's launch speed, blocks a tick. */
  public static final double SPEED = 1.5;

  /** Its fall acceleration, blocks a tick per tick. */
  public static final double GRAVITY = 0.03;

  /** The share of its speed it keeps each tick. */
  public static final double DRAG = 0.99;

  /** How far below the eye a pearl leaves the hand. */
  static final double RELEASE_DROP = 0.1;

  /** The longest flight followed, ticks. */
  static final int MAX_TICKS = 120;

  private static final double LOWEST_PITCH = 60;
  private static final double HIGHEST_PITCH = -40;
  private static final int ITERATIONS = 32;

  private PearlFlight() {}

  /**
   * Where a pearl thrown from {@code eye} looking {@code aim} lands, if it lands safely.
   *
   * @param grid the map
   * @param eye the thrower's eye
   * @param aim the look
   * @param carried the thrower's own motion the pearl carries off, blocks a tick
   */
  public static Optional<Vec3> landing(VoxelGrid grid, Vec3 eye, Facing aim, Vec3 carried) {
    var pos = eye.plus(0, -RELEASE_DROP, 0);
    var vel = aim.direction().scale(SPEED).plus(carried);
    for (var tick = 0; tick < MAX_TICKS; tick++) {
      var next = pos.plus(vel);
      var hit = grid.raycast(pos, next, VoxelGrid.Layer.PROJECTILE);
      if (hit.isPresent()) {
        return topLanding(grid, pos, next, hit.orElseThrow());
      }
      if (next.y() < grid.bounds().origin().y()) {
        return Optional.empty();
      }
      pos = next;
      vel = vel.scale(DRAG).plus(0, -GRAVITY, 0);
    }
    return Optional.empty();
  }

  /**
   * The look that throws a pearl from {@code eye} down onto {@code target} in open air, on the low
   * arc, if it is in range.
   */
  public static Optional<Facing> aim(Vec3 eye, Vec3 target) {
    var flat = target.minus(eye).horizontal();
    var distance = flat.length();
    if (distance < 1) {
      return Optional.empty();
    }
    var yaw = Facing.of(flat).yaw();
    var low = HIGHEST_PITCH;
    var high = LOWEST_PITCH;
    if (reach(eye, target.y(), new Facing(yaw, low)) < distance) {
      return Optional.empty();
    }
    for (var i = 0; i < ITERATIONS; i++) {
      var mid = (low + high) / 2;
      if (reach(eye, target.y(), new Facing(yaw, mid)) >= distance) {
        low = mid;
      } else {
        high = mid;
      }
    }
    return Optional.of(new Facing(yaw, low));
  }

  /**
   * How far across the ground, in open air, a pearl thrown along {@code aim} has gone when it falls
   * through {@code height}; zero when it never comes down to it.
   */
  static double reach(Vec3 eye, double height, Facing aim) {
    var pos = eye.plus(0, -RELEASE_DROP, 0);
    var vel = aim.direction().scale(SPEED);
    var start = pos;
    for (var tick = 0; tick < MAX_TICKS; tick++) {
      var next = pos.plus(vel);
      if (vel.y() < 0 && next.y() <= height) {
        var share = pos.y() == next.y() ? 0 : (pos.y() - height) / (pos.y() - next.y());
        return pos.lerp(next, Math.clamp(share, 0, 1)).horizontalDistance(start);
      }
      pos = next;
      vel = vel.scale(DRAG).plus(0, -GRAVITY, 0);
    }
    return 0;
  }

  /** Where the segment from {@code from} to {@code to} enters {@code block} from above, if safe. */
  private static Optional<Vec3> topLanding(VoxelGrid grid, Vec3 from, Vec3 to, BlockPos block) {
    var top = block.y() + 1.0;
    if (!(from.y() >= top && to.y() < top)) {
      return Optional.empty();
    }
    var share = (from.y() - top) / (from.y() - to.y());
    var touch = from.lerp(to, share);
    if (Math.floor(touch.x()) != block.x() || Math.floor(touch.z()) != block.z()) {
      return Optional.empty();
    }
    var feet = block.up();
    if (!grid.bounds().contains(block)
        || !grid.bounds().contains(feet.up())
        || !grid.blocksMovement(block)
        || grid.blocksMovement(feet)
        || grid.blocksMovement(feet.up())) {
      return Optional.empty();
    }
    return Optional.of(touch);
  }
}
