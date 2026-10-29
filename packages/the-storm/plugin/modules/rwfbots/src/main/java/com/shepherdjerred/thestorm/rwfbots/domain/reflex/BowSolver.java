package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import java.util.Optional;
import java.util.OptionalDouble;

/**
 * Finds the pitch that lands an arrow on a point. Arrows leave at {@link #FULL_DRAW_SPEED} blocks
 * per tick, then every tick move, lose one percent of their speed and gain {@link #GRAVITY}
 * downwards, so the solver bisects on the launch elevation over a simulated flight and returns the
 * flatter of the two arcs.
 */
public final class BowSolver {

  /** Arrow speed at full draw, blocks per tick. */
  public static final double FULL_DRAW_SPEED = 3.0;

  /** Downward acceleration per tick. */
  public static final double GRAVITY = 0.05;

  /** Speed kept each tick. */
  public static final double DRAG = 0.99;

  /** Ticks of drawing before the arrow leaves at full speed. */
  public static final int FULL_DRAW_TICKS = 20;

  private static final int MAX_FLIGHT_TICKS = 200;
  private static final int ITERATIONS = 40;
  private static final double LOWEST_ELEVATION = -89;
  private static final double HIGHEST_ELEVATION = 60;

  /** Height above the feet an arrow aims for: the middle of the body. */
  static final double BODY_CENTRE = 1.3;

  /**
   * The most a jump lifts feet above the ground it left, blocks. Ground further below an airborne
   * target is not where it lands from a jump: it is climbing, swimming or falling, and the bow
   * keeps its own height.
   */
  static final double JUMP_APEX = 1.3;

  private BowSolver() {}

  /**
   * Where to aim at {@code target} for an arrow {@code leadTicks} in flight: its body centre, led
   * by its horizontal velocity, at the height a jumping target lands on. Leading a jump's upward
   * velocity aimed blocks above a target that is back on the ground when the arrow arrives.
   */
  public static Vec3 lead(VoxelGrid grid, CombatantView target, double leadTicks) {
    var feet = target.pos().plus(target.vel().horizontal().scale(leadTicks));
    var y = target.onGround() ? target.pos().y() : landing(grid, feet.withY(target.pos().y()));
    return new Vec3(feet.x(), y + BODY_CENTRE, feet.z());
  }

  /** The top of the solid cell a jump at {@code above} comes down on, or its own height. */
  private static double landing(VoxelGrid grid, Vec3 above) {
    var x = (int) Math.floor(above.x());
    var z = (int) Math.floor(above.z());
    var lowest = (int) Math.floor(above.y() - JUMP_APEX);
    for (var y = (int) Math.floor(above.y()); y >= lowest; y--) {
      if (grid.bounds().contains(x, y, z) && grid.blocks(x, y, z, VoxelGrid.Layer.MOVEMENT))
        return Math.max(Math.min(above.y(), y + 1.0), above.y() - JUMP_APEX);
    }
    return above.y();
  }

  /** One tick of arrow motion from {@code pos} with {@code vel}: the new position and velocity. */
  public record Arrow(Vec3 pos, Vec3 vel) {

    public Arrow step() {
      var next = pos.plus(vel);
      var slowed = vel.scale(DRAG).plus(0, -GRAVITY, 0);
      return new Arrow(next, slowed);
    }
  }

  /**
   * The Minecraft pitch (positive is down) to launch from {@code from} at {@code speed} and pass
   * through {@code target}, or empty when the target is out of range.
   */
  public static OptionalDouble solve(Vec3 from, Vec3 target, double speed) {
    var horizontal = from.horizontalDistance(target);
    var rise = target.y() - from.y();
    if (horizontal < 1.0e-6) {
      return OptionalDouble.empty();
    }
    var lo = LOWEST_ELEVATION;
    var hi = HIGHEST_ELEVATION;
    var atLo = heightAt(horizontal, lo, speed) - rise;
    var atHi = heightAt(horizontal, hi, speed) - rise;
    if (atLo > 0 || atHi < 0) {
      return OptionalDouble.empty();
    }
    for (var i = 0; i < ITERATIONS; i++) {
      var mid = (lo + hi) / 2;
      if (heightAt(horizontal, mid, speed) - rise < 0) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return OptionalDouble.of(-(lo + hi) / 2);
  }

  /**
   * The facing (yaw towards it, solved pitch) that lands an arrow from {@code from} on {@code
   * target}, or empty when it is out of range.
   */
  public static Optional<Facing> facing(Vec3 from, Vec3 target, double speed) {
    var pitch = solve(from, target, speed);
    if (pitch.isEmpty()) return Optional.empty();
    return Optional.of(new Facing(Facing.looking(from, target).yaw(), pitch.getAsDouble()));
  }

  /**
   * The arrow's height above the launch point when it has covered {@code horizontal} blocks, fired
   * at {@code elevationDegrees} (positive is up); very negative if it never gets that far.
   */
  static double heightAt(double horizontal, double elevationDegrees, double speed) {
    var elevation = Math.toRadians(elevationDegrees);
    var arrow =
        new Arrow(
            Vec3.ZERO,
            new Vec3(speed * StrictMath.cos(elevation), speed * StrictMath.sin(elevation), 0));
    for (var tick = 0; tick < MAX_FLIGHT_TICKS; tick++) {
      var next = arrow.step();
      if (next.pos().x() >= horizontal) {
        var fraction = (horizontal - arrow.pos().x()) / (next.pos().x() - arrow.pos().x());
        return arrow.pos().y() + fraction * (next.pos().y() - arrow.pos().y());
      }
      arrow = next;
    }
    return Double.NEGATIVE_INFINITY;
  }

  /** Roughly how many ticks an arrow takes to cover {@code horizontal} blocks at {@code speed}. */
  public static int flightTicks(double horizontal, double speed) {
    var arrow = new Arrow(Vec3.ZERO, new Vec3(speed, 0, 0));
    for (var tick = 1; tick <= MAX_FLIGHT_TICKS; tick++) {
      arrow = arrow.step();
      if (arrow.pos().x() >= horizontal) {
        return tick;
      }
    }
    return MAX_FLIGHT_TICKS;
  }
}
