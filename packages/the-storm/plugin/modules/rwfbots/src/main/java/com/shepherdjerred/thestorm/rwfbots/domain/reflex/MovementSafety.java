package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
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
  // How far from its footing a body still only needs footing, while it steps back from an edge.
  private static final double LEAVING = 0.5;
  // The height of a stair step or a slab, the grain a staircase descends in.
  private static final double HALF_STEP = 0.5;
  // Within this of its cell's centre a body already takes off from there.
  private static final double CENTRED = 0.05;
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

    /** Whether a body there holds onto a ladder, vine or other climbable block. */
    boolean climbable(Vec3 feet);

    /** Whether any part of the body's footprint there rests on floor within {@code drop}. */
    boolean footing(Vec3 feet, double drop);

    /** Whether a body there is in water. */
    boolean submerged(Vec3 feet);
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
      if (climb(terrain, request)) return new Result(Optional.of(request.target()), Reason.CLEAR);
      return climbAround(terrain, request.from(), request.target())
          .map(corner -> new Result(Optional.of(corner), Reason.REDIRECTED))
          .orElseGet(() -> new Result(Optional.empty(), Reason.BLOCKED));
    }
    if (request.hop() == Hop.SWIM) {
      return swim(terrain, request.from(), request.target());
    }
    if (request.hop() == Hop.LEAP || request.hop() == Hop.DROP || request.hop() == Hop.JUMP) {
      if (traversal(terrain, request) || walksDown(terrain, request))
        return new Result(Optional.of(request.target()), Reason.CLEAR);
      return takeoff(terrain, request)
          .or(() -> sinkFirst(terrain, request))
          .or(() -> dropAround(terrain, request))
          .map(corner -> new Result(Optional.of(corner), Reason.REDIRECTED))
          .orElseGet(() -> new Result(Optional.empty(), Reason.BLOCKED));
    }
    var heading = request.target().minus(request.from()).horizontal();
    if (heading.isZero()) {
      return new Result(Optional.empty(), Reason.ARRIVED);
    }
    var walked = steer(terrain, request, heading);
    if (walked.reason() != Reason.BLOCKED) return walked;
    if (steppingDown(terrain, request))
      return new Result(Optional.of(request.target()), Reason.CLEAR);
    return climbAround(terrain, request.from(), request.target())
        .map(corner -> new Result(Optional.of(corner), Reason.REDIRECTED))
        .orElse(walked);
  }

  /**
   * The centre of the cell a grounded body stands in, when the traversal it was refused is clear
   * from there and it can walk there: a body standing off its node's centre may otherwise raise its
   * head into an overhang beside it for every jump (hemispheres: a stair under a balcony).
   */
  private static Optional<Vec3> takeoff(Terrain terrain, Request request) {
    var from = request.from();
    if (request.takeoff().isPresent() || !terrain.grounded(from)) return Optional.empty();
    var centre = new Vec3(Math.floor(from.x()) + 0.5, from.y(), Math.floor(from.z()) + 0.5);
    if (centre.horizontalDistance(from) < CENTRED) return Optional.empty();
    return walkCorridor(terrain, from, centre, true)
            && traversal(terrain, new Request(centre, request.target(), request.hop()))
        ? Optional.of(centre)
        : Optional.empty();
  }

  /**
   * Whether a drop is a walk down a staircase: a grounded body that follows the highest footing
   * under it, half a block at a time between its feet and the landing, stays clear all the way. A
   * flight held at the take-off height hits the low ceiling over a stairwell or the next turn of
   * its stairs, though the body walking down never rises that high (hemispheres: tower stairs).
   */
  private static boolean walksDown(Terrain terrain, Request request) {
    var from = request.from();
    var target = request.target();
    if (request.hop() != Hop.DROP
        || request.takeoff().isPresent()
        || target.y() >= from.y()
        || from.horizontalDistance(target) > MAX_LEAP_SPAN
        || !terrain.grounded(from)
        || !safe(terrain, target)
        || !terrain.supported(target, WALK_DROP)) return false;
    return downLeg(terrain, from, target, new Band(from.y(), target.y()));
  }

  /**
   * For a drop blocked straight, the axis turn a grounded body walks down by instead, rounding the
   * corner of a stair turn or a column the straight line cuts through (hemispheres: tower stairs).
   */
  private static Optional<Vec3> dropAround(Terrain terrain, Request request) {
    var from = request.from();
    var target = request.target();
    if (request.hop() != Hop.DROP
        || request.takeoff().isPresent()
        || target.y() > from.y()
        || !terrain.grounded(from)
        || !safe(terrain, target)
        || !terrain.supported(target, WALK_DROP)) return Optional.empty();
    for (var corner : turns(from, target)) {
      if (corner.horizontalDistance(from) < CENTRED || corner.horizontalDistance(target) < CENTRED)
        continue;
      var band = new Band(from.y(), target.y());
      if (downLeg(terrain, from, corner, band) && downLeg(terrain, corner, target, band))
        return Optional.of(corner);
    }
    return Optional.empty();
  }

  /** The heights a body walking down stays between: its take-off height and its landing's. */
  private record Band(double top, double bottom) {}

  /** Whether a body walking down from {@code from} to {@code to} passes every sample. */
  private static boolean downLeg(Terrain terrain, Vec3 from, Vec3 to, Band band) {
    var count = Math.max(1, (int) Math.ceil(from.horizontalDistance(to) / SAMPLE_GAP));
    for (var index = 0; index <= count; index++) {
      if (!passesDown(terrain, from.lerp(to, (double) index / count), band.top(), band.bottom()))
        return false;
    }
    return true;
  }

  /**
   * Whether a body walking down passes {@code sample}: clear at the highest half-block height from
   * {@code top} down to {@code bottom} it has footing at, or, with footing at none (stepping off
   * one onto the next), clear at any of them as it falls between.
   */
  private static boolean passesDown(Terrain terrain, Vec3 sample, double top, double bottom) {
    var clearAbove = false;
    for (var height = top; height >= bottom - 1e-9; height -= HALF_STEP) {
      var point = sample.withY(Math.max(height, bottom));
      var clear = safe(terrain, point);
      if (terrain.grounded(point)) return clear || clearAbove;
      clearAbove |= clear;
    }
    return clearAbove;
  }

  /**
   * For a drop from water whose flight is blocked, the point straight below at the target's height
   * when the body can sink there through water and then cross to the target: the way out of a well
   * is down the column and out through its side, not across at the surface.
   */
  private static Optional<Vec3> sinkFirst(Terrain terrain, Request request) {
    var from = request.from();
    var target = request.target();
    if (request.hop() != Hop.DROP || !terrain.submerged(from) || target.y() >= from.y())
      return Optional.empty();
    var corner = from.withY(target.y());
    if (corner.horizontalDistance(target) < CENTRED) return Optional.empty();
    var count = Math.max(1, (int) Math.ceil((from.y() - corner.y()) / SAMPLE_GAP));
    for (var index = 0; index <= count; index++) {
      var point = from.lerp(corner, (double) index / count);
      if (!safe(terrain, point) || (index < count && !terrain.submerged(point)))
        return Optional.empty();
    }
    return clearFlight(terrain, corner, target, corner.y())
        ? Optional.of(corner)
        : Optional.empty();
  }

  /**
   * The first corner of a two-leg way between a climbable and the ground, when the straight way is
   * refused: rise or descend to the target's height and then step across (out of the top of a
   * ladder, down a vine under an overhang), or step across and then climb or drop (over a ladder
   * hole, onto a vine). A vertical leg must be clear; every sample of a crossing must be held by
   * floor or a climbable within reach. Empty when neither end is at a climbable or no way is open.
   */
  static Optional<Vec3> climbAround(Terrain terrain, Vec3 from, Vec3 target) {
    var holding = grips(terrain, from);
    if (!holding && !grips(terrain, target)) return Optional.empty();
    var vertical = from.withY(target.y());
    var across = target.withY(from.y());
    // Only a body holding a climbable can rise or sink in place; one on the ground crosses first.
    var corners = new ArrayList<>(holding ? List.of(vertical, across) : List.of(across, vertical));
    corners.addAll(turns(from, target));
    for (var corner : corners) {
      if (corner.distance(from) < 1e-6 || corner.distance(target) < 1e-6) continue;
      if (climbLeg(terrain, from, corner) && climbLeg(terrain, corner, target))
        return Optional.of(corner);
    }
    return Optional.empty();
  }

  /** The two axis-aligned turning points from {@code from} to {@code target} at its height. */
  private static List<Vec3> turns(Vec3 from, Vec3 target) {
    return List.of(
        new Vec3(from.x(), from.y(), target.z()), new Vec3(target.x(), from.y(), from.z()));
  }

  private static boolean grips(Terrain terrain, Vec3 point) {
    return terrain.climbable(point) || terrain.climbable(point.plus(0, -1, 0));
  }

  private static boolean climbLeg(Terrain terrain, Vec3 from, Vec3 to) {
    var vertical = from.horizontalDistance(to) < 1e-6;
    var count = Math.max(1, (int) Math.ceil(from.distance(to) / SAMPLE_GAP));
    for (var index = 0; index <= count; index++) {
      var point = from.lerp(to, (double) index / count);
      if (!safe(terrain, point)) return false;
      if (!vertical && !grips(terrain, point) && !terrain.supported(point, WALK_DROP)) return false;
    }
    return true;
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
      var ends = angle == 0 && heading.length() <= LOOK_AHEAD;
      if (walkCorridor(terrain, request.from(), probe, ends)) {
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
      var problem = problem(terrain, point, point.horizontalDistance(from) <= LEAVING, check);
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

  private static Optional<String> problem(
      Terrain terrain, Vec3 sample, boolean leaving, Check check) {
    if (!terrain.inside(sample)) return Optional.of("outside");
    var stepped = check == Check.WALK ? stood(terrain, sample) : Optional.<Vec3>empty();
    if (!terrain.clear(sample) && stepped.isEmpty()) return Optional.of("collides");
    var point = stepped.orElse(sample);
    if (terrain.hazardous(point)) return Optional.of("hazardous");
    return switch (check) {
      case WALK ->
          floor(terrain, point, leaving) || terrain.footing(point, WALK_DROP)
              ? Optional.empty()
              : Optional.of("no footing within a step");
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
    var flat = "flight " + leg(terrain, from.withY(flightY), target.withY(flightY), Check.CLEAR);
    if (request.takeoff().isPresent() || !terrain.grounded(from)) return flat;
    var stepped = flightY + STEP_HEIGHT;
    var both =
        flat
            + ", stepped up "
            + leg(terrain, from.withY(stepped), target.withY(stepped), Check.CLEAR);
    return request.hop() == Hop.DROP && target.y() < from.y()
        ? both + ", walking down " + walkingDown(terrain, from, target)
        : both;
  }

  /** The first sample a walk down from {@code from} to {@code target} does not pass, or clear. */
  private static String walkingDown(Terrain terrain, Vec3 from, Vec3 target) {
    var count = Math.max(1, (int) Math.ceil(from.horizontalDistance(target) / SAMPLE_GAP));
    for (var index = 0; index <= count; index++) {
      var sample = from.lerp(target, (double) index / count);
      if (!passesDown(terrain, sample, from.y(), target.y()))
        return String.format(
            Locale.ROOT,
            "sample %d/%d at %.2f,%.2f blocked at every height",
            index,
            count,
            sample.x(),
            sample.z());
    }
    return "clear";
  }

  /**
   * An ordinary walk: like {@link #supportedCorridor}, but a sample between its ends only needs
   * footing, some of the footprint on floor within a step, as vanilla holds a body crossing between
   * blocks that touch at a corner or along a one-block walkway. Where the walk ends ({@code ends}:
   * the probe reaches the target) must be fully supported, so a walk never stops hanging off an
   * edge; a look-ahead point short of the target is only on the way.
   */
  private static boolean walkCorridor(Terrain terrain, Vec3 from, Vec3 to, boolean ends) {
    var count = Math.max(1, (int) Math.ceil(from.horizontalDistance(to) / SAMPLE_GAP));
    var escaping = terrain.hazardous(from);
    for (var index = 0; index <= count; index++) {
      var sample = from.lerp(to, (double) index / count);
      if (!terrain.inside(sample)) return false;
      var point = stood(terrain, sample);
      if (point.isEmpty()) return false;
      if (escaping && index != count) continue;
      var on = index > 0 && (index < count || !ends);
      if (!walkable(terrain, point.orElseThrow(), sample.horizontalDistance(from), on))
        return false;
    }
    return true;
  }

  /**
   * Whether a walk may pass {@code at}, {@code away} from where it set off: not hazardous, and
   * supported, or footed where the walk is only passing ({@code passing}).
   */
  private static boolean walkable(Terrain terrain, Vec3 at, double away, boolean passing) {
    if (terrain.hazardous(at)) return false;
    return floor(terrain, at, away <= LEAVING) || (passing && terrain.footing(at, WALK_DROP));
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
        if (terrain.hazardous(point.orElseThrow())
            || !floor(terrain, point.orElseThrow(), sample.horizontalDistance(from) <= LEAVING))
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

  /**
   * Floor under a walking sample: full support, or, within {@link #LEAVING} of where the body
   * stands, any footing vanilla holds it on, so a body at the edge of a narrow walkway or ledge may
   * step back from it although it may not walk out to such an edge.
   */
  private static boolean floor(Terrain terrain, Vec3 point, boolean leaving) {
    return terrain.supported(point, WALK_DROP) || (leaving && terrain.grounded(point));
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
    // Round a block corner along one axis and then the other rather than clip it.
    for (var turn : turns(from, target)) {
      if (swimCorridor(terrain, from, turn) && swimCorridor(terrain, turn, target))
        return new Result(Optional.of(turn), Reason.REDIRECTED);
    }
    return new Result(Optional.empty(), Reason.BLOCKED);
  }

  private static boolean traversal(Terrain terrain, Request request) {
    var from = request.from();
    var target = request.target();
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
    // A grounded body steps up a half block or a stair's tall half on its way, as vanilla does.
    return clearFlight(terrain, from, target, flightY)
        || (request.takeoff().isEmpty()
            && terrain.grounded(from)
            && clearFlight(terrain, from, target, flightY + STEP_HEIGHT));
  }

  private static boolean clearFlight(Terrain terrain, Vec3 from, Vec3 target, double flightY) {
    var count = Math.max(1, (int) Math.ceil(from.horizontalDistance(target) / SAMPLE_GAP));
    for (var index = 0; index <= count; index++) {
      if (!safe(terrain, from.lerp(target, (double) index / count).withY(flightY))) return false;
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
