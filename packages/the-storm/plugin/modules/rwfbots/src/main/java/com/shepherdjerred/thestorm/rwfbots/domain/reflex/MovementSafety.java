package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.Optional;

/** The last movement gate, including local combat steering and bounded recovery sidesteps. */
public final class MovementSafety {
  private static final double LOOK_AHEAD = 0.9;
  private static final double SAMPLE_GAP = 0.2;
  private static final double WALK_DROP = 1.1;
  private static final double MAX_JUMP_RISE = 1.75;
  // The upstream directed graph permits four-cell diagonal launches (sqrt(32) blocks).
  private static final double MAX_LEAP_SPAN = 6;
  private static final double[] ANGLES = {0, 30, -30, 60, -60, 90, -90};

  private MovementSafety() {}

  /** Live collision, damaging blocks, floor support and map bounds, queried on the main thread. */
  public interface Terrain {
    boolean clear(Vec3 feet);

    boolean supported(Vec3 feet, double drop);

    boolean hazardous(Vec3 feet);

    boolean inside(Vec3 feet);
  }

  public record Request(Vec3 from, Vec3 target, Hop hop, Optional<Vec3> takeoff) {
    public Request(Vec3 from, Vec3 target, Hop hop) {
      this(from, target, hop, Optional.empty());
    }
  }

  public enum Reason {
    CLEAR,
    REDIRECTED,
    BLOCKED,
    ARRIVED
  }

  public record Result(Optional<Vec3> destination, Reason reason) {}

  /**
   * Keeps ordinary steering on supported terrain. Only an explicit authored traversal may cross a
   * gap or descend farther than an ordinary step; it still needs clear flight and a safe landing.
   */
  public static Result choose(Terrain terrain, Request request) {
    if (request.hop() == Hop.CLIMB) {
      return climb(terrain, request)
          ? new Result(Optional.of(request.target()), Reason.CLEAR)
          : new Result(Optional.empty(), Reason.BLOCKED);
    }
    if (request.hop() == Hop.SWIM) {
      return swimCorridor(terrain, request.from(), request.target())
          ? new Result(Optional.of(request.target()), Reason.CLEAR)
          : new Result(Optional.empty(), Reason.BLOCKED);
    }
    if (request.hop() == Hop.LEAP || request.hop() == Hop.DROP || request.hop() == Hop.JUMP) {
      return traversal(terrain, request)
          ? new Result(Optional.of(request.target()), Reason.CLEAR)
          : new Result(Optional.empty(), Reason.BLOCKED);
    }
    var heading = request.target().minus(request.from()).horizontal();
    if (heading.isZero()) {
      return new Result(Optional.empty(), Reason.ARRIVED);
    }
    return steer(terrain, request, heading);
  }

  private static Result steer(Terrain terrain, Request request, Vec3 heading) {
    var direction = heading.normalized();
    var distance = Math.min(LOOK_AHEAD, heading.length());
    for (var angle : ANGLES) {
      var rotated = rotate(direction, angle);
      var probe = request.from().plus(rotated.scale(distance));
      if (supportedCorridor(terrain, request.from(), probe)) {
        var destination =
            angle == 0 ? request.target() : request.from().plus(rotated.scale(distance));
        return new Result(Optional.of(destination), angle == 0 ? Reason.CLEAR : Reason.REDIRECTED);
      }
    }
    return new Result(Optional.empty(), Reason.BLOCKED);
  }

  /** A straight combat approach must have continuous floor, not merely unobstructed sight. */
  public static boolean supportedCorridor(Terrain terrain, Vec3 from, Vec3 to) {
    var count = Math.max(1, (int) Math.ceil(from.horizontalDistance(to) / SAMPLE_GAP));
    var escaping = terrain.hazardous(from);
    for (var index = 0; index <= count; index++) {
      var point = from.lerp(to, (double) index / count);
      if (!terrain.inside(point) || !terrain.clear(point)) return false;
      if (!escaping || index == count) {
        if (terrain.hazardous(point) || !terrain.supported(point, WALK_DROP)) return false;
      }
    }
    return true;
  }

  private static boolean clearCorridor(Terrain terrain, Vec3 from, Vec3 to) {
    var count = Math.max(1, (int) Math.ceil(from.distance(to) / SAMPLE_GAP));
    for (var index = 0; index <= count; index++) {
      if (!safe(terrain, from.lerp(to, (double) index / count))) return false;
    }
    return true;
  }

  private static boolean swimCorridor(Terrain terrain, Vec3 from, Vec3 to) {
    var count = Math.max(1, (int) Math.ceil(from.distance(to) / SAMPLE_GAP));
    for (var index = 0; index <= count; index++) {
      var point = from.lerp(to, (double) index / count);
      if (!safe(terrain, point) || !terrain.supported(point, WALK_DROP)) return false;
    }
    return true;
  }

  private static boolean traversal(Terrain terrain, Request request) {
    var from = request.from();
    var target = request.target();
    var distance = from.horizontalDistance(target);
    var origin = request.takeoff().orElse(from);
    var descent = origin.y() - target.y();
    if (origin.horizontalDistance(target) > MAX_LEAP_SPAN
        || descent < -MAX_JUMP_RISE
        || !safe(terrain, target)
        || !terrain.supported(target, WALK_DROP)) {
      return false;
    }
    var flightY =
        Math.max(from.y(), target.y())
            + (request.hop() == Hop.LEAP && request.takeoff().isEmpty() ? 1.3 : 0);
    var count = Math.max(1, (int) Math.ceil(distance / SAMPLE_GAP));
    for (var index = 0; index <= count; index++) {
      if (!safe(terrain, from.lerp(target, (double) index / count).withY(flightY))) {
        return false;
      }
    }
    return true;
  }

  private static boolean climb(Terrain terrain, Request request) {
    var from = request.from();
    var target = request.target();
    if (from.horizontalDistance(target) < 0.01) return clearCorridor(terrain, from, target);
    if (from.horizontalDistance(target) > 1.5
        || target.y() - from.y() > MAX_JUMP_RISE
        || !safe(terrain, target)
        || !terrain.supported(target, WALK_DROP)) return false;
    var raised = from.withY(Math.max(from.y(), target.y()));
    return clearCorridor(terrain, from, raised) && clearCorridor(terrain, raised, target);
  }

  private static boolean safe(Terrain terrain, Vec3 point) {
    return terrain.inside(point) && terrain.clear(point) && !terrain.hazardous(point);
  }

  private static Vec3 rotate(Vec3 direction, double degrees) {
    var angle = Math.toRadians(degrees);
    var cosine = StrictMath.cos(angle);
    var sine = StrictMath.sin(angle);
    return new Vec3(
        direction.x() * cosine - direction.z() * sine,
        0,
        direction.x() * sine + direction.z() * cosine);
  }
}
