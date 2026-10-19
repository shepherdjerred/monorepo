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
  // Vanilla walks a body up a ledge this high (a slab or a stair step) without a jump.
  private static final double STEP_HEIGHT = 0.6;
  private static final double[] ANGLES = {0, 30, -30, 60, -60, 90, -90};

  private MovementSafety() {}

  /** Live collision, damaging blocks, floor support and map bounds, queried on the main thread. */
  public interface Terrain {
    boolean clear(Vec3 feet);

    boolean supported(Vec3 feet, double drop);

    /** Actual current ground contact, even when part of the standing footprint overhangs. */
    boolean grounded(Vec3 feet);

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
    /** The step is clear, but the body's landing check forecasts damage it must not take. */
    UNSAFE_LANDING,
    ARRIVED;

    /** Whether the body refused to take the step at all. */
    public boolean refused() {
      return this == BLOCKED || this == UNSAFE_LANDING;
    }
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
      return swim(terrain, request.from(), request.target());
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
    var walked = steer(terrain, request, heading);
    if (walked.reason() == Reason.BLOCKED && steppingDown(terrain, request))
      return new Result(Optional.of(request.target()), Reason.CLEAR);
    return walked;
  }

  /**
   * Whether a walk refused only for want of floor within a step is a safe drop instead: the target
   * lies more than a step below, with clear flight to it and a supported landing. A body perched on
   * a block edge, a stall counter or a roof is routed from the graph node beneath it, so its next
   * waypoint is an ordinary walk; refusing to step off left it standing there for minutes. The
   * body's final landing check still rules out damage it must not take.
   */
  private static boolean steppingDown(Terrain terrain, Request request) {
    return request.from().y() - request.target().y() > WALK_DROP
        && traversal(terrain, new Request(request.from(), request.target(), Hop.DROP));
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

  /**
   * Why {@code request} is refused, replaying the path its own check takes: the first sample of a
   * walking corridor, swimming leg, climb or flight that is outside the map, collides, is hazardous
   * or lacks support, or which condition on its target fails. A diagnostic for stuck bodies, not a
   * decision.
   */
  public static String explain(Terrain terrain, Request request) {
    var from = request.from();
    var target = request.target();
    return switch (request.hop()) {
      case WALK -> {
        var heading = target.minus(from).horizontal();
        var to =
            heading.isZero()
                ? target
                : from.plus(heading.normalized().scale(Math.min(LOOK_AHEAD, heading.length())));
        yield "walk " + leg(terrain, from, to, Check.WALK);
      }
      case SWIM -> {
        var corner = target.y() > from.y() ? from.withY(target.y()) : target.withY(from.y());
        yield "swim straight "
            + leg(terrain, from, target, Check.SWIM)
            + ", via corner "
            + leg(terrain, from, corner, Check.SWIM)
            + " then "
            + leg(terrain, corner, target, Check.SWIM);
      }
      case CLIMB -> climbing(terrain, from, target);
      case LEAP, DROP, JUMP -> flying(terrain, request);
    };
  }

  private enum Check {
    WALK,
    SWIM,
    CLEAR
  }

  private static String leg(Terrain terrain, Vec3 from, Vec3 to, Check check) {
    var count = Math.max(1, (int) Math.ceil(from.distance(to) / SAMPLE_GAP));
    for (var index = 0; index <= count; index++) {
      var point = from.lerp(to, (double) index / count);
      var problem = problem(terrain, point, index, check);
      if (problem.isPresent())
        return String.format(
            java.util.Locale.ROOT,
            "sample %d/%d at %.2f,%.2f,%.2f %s",
            index,
            count,
            point.x(),
            point.y(),
            point.z(),
            problem.orElseThrow());
    }
    return "clear";
  }

  private static Optional<String> problem(Terrain terrain, Vec3 sample, int index, Check check) {
    if (!terrain.inside(sample)) return Optional.of("outside");
    var stepped = check == Check.WALK ? stood(terrain, sample) : Optional.<Vec3>empty();
    if (!terrain.clear(sample) && stepped.isEmpty()) return Optional.of("collides");
    var point = stepped.orElse(sample);
    if (terrain.hazardous(point)) return Optional.of("hazardous");
    return switch (check) {
      case WALK ->
          floor(terrain, point, index) ? Optional.empty() : Optional.of("no floor within a step");
      case SWIM ->
          terrain.supported(point, WALK_DROP)
              ? Optional.empty()
              : Optional.of("no water or floor within a step");
      case CLEAR -> Optional.empty();
    };
  }

  private static String climbing(Terrain terrain, Vec3 from, Vec3 target) {
    if (from.horizontalDistance(target) > 1.5) return "climb target too far across";
    if (target.y() - from.y() > MAX_JUMP_RISE) return "climb target too far above";
    if (!safe(terrain, target)) return "climb target " + leg(terrain, target, target, Check.CLEAR);
    if (!terrain.supported(target, WALK_DROP)) return "climb target unsupported";
    var raised = from.withY(Math.max(from.y(), target.y()));
    return "climb up "
        + leg(terrain, from, raised, Check.CLEAR)
        + " then across "
        + leg(terrain, raised, target, Check.CLEAR);
  }

  private static String flying(Terrain terrain, Request request) {
    var from = request.from();
    var target = request.target();
    var origin = request.takeoff().orElse(from);
    if (origin.horizontalDistance(target) > MAX_LEAP_SPAN) return "flight too long";
    if (origin.y() - target.y() < -MAX_JUMP_RISE) return "flight rises too far";
    if (!safe(terrain, target)) return "landing " + leg(terrain, target, target, Check.CLEAR);
    if (!terrain.supported(target, WALK_DROP)) return "landing unsupported";
    var flightY =
        Math.max(from.y(), target.y())
            + (request.hop() == Hop.LEAP && request.takeoff().isEmpty() ? 1.3 : 0);
    return "flight " + leg(terrain, from.withY(flightY), target.withY(flightY), Check.CLEAR);
  }

  /** A straight combat approach must have continuous floor, not merely unobstructed sight. */
  public static boolean supportedCorridor(Terrain terrain, Vec3 from, Vec3 to) {
    var count = Math.max(1, (int) Math.ceil(from.horizontalDistance(to) / SAMPLE_GAP));
    var escaping = terrain.hazardous(from);
    for (var index = 0; index <= count; index++) {
      var sample = from.lerp(to, (double) index / count);
      if (!terrain.inside(sample)) return false;
      var point = stood(terrain, sample);
      if (point.isEmpty()) return false;
      if (!escaping || index == count) {
        if (terrain.hazardous(point.orElseThrow()) || !floor(terrain, point.orElseThrow(), index))
          return false;
      }
    }
    return true;
  }

  /**
   * Where a walking body stands at {@code point}: there when clear, else on top of a ledge no
   * higher than vanilla's step height, which a walk climbs as it goes; empty when neither is clear.
   * Floor and hazards are judged where it stands, so the top of a stair or a ladder exit counts as
   * floor. Without the step a slab or stair edge read as a wall, so a bot walking up one
   * sidestepped along it instead.
   */
  private static Optional<Vec3> stood(Terrain terrain, Vec3 point) {
    if (terrain.clear(point)) return Optional.of(point);
    var stepped = point.plus(0, STEP_HEIGHT, 0);
    return terrain.clear(stepped) ? Optional.of(stepped) : Optional.empty();
  }

  private static boolean floor(Terrain terrain, Vec3 point, int index) {
    return terrain.supported(point, WALK_DROP) || (index == 0 && terrain.grounded(point));
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

  private static Result swim(Terrain terrain, Vec3 from, Vec3 target) {
    if (swimCorridor(terrain, from, target)) return new Result(Optional.of(target), Reason.CLEAR);
    // A bank face needs ascent before crossing; a lowered pool needs crossing before descent.
    var corner = target.y() > from.y() ? from.withY(target.y()) : target.withY(from.y());
    if (swimCorridor(terrain, from, corner) && swimCorridor(terrain, corner, target))
      return new Result(Optional.of(corner), Reason.CLEAR);
    return new Result(Optional.empty(), Reason.BLOCKED);
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
