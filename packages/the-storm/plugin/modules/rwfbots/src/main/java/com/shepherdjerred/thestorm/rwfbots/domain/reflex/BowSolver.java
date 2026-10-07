package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
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

  private BowSolver() {}

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
