package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.JumpLaunch;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.List;
import java.util.Optional;

/**
 * Executes the actual baked run-up and minimum forward momentum before issuing a sprint jump. A
 * body already running at the takeoff along the run-up line joins the run-up where it is; only a
 * side, stalled or overshooting approach backs up to the measured run-up start.
 */
public final class JumpController {
  static final double MAX_CROSS_TRACK = 0.05;
  static final double MAX_HEIGHT_ERROR = 0.05;
  static final double MIN_LAUNCH_ALONG = -0.1;
  static final double MAX_LAUNCH_ALONG = 0.18;
  static final double RUN_UP_START_REACH = 0.2;

  /** The widest cross-track a forward approach may still close onto the run-up line. */
  static final double MAX_JOIN_CROSS = 0.4;

  /** How far before the measured run-up start a forward approach may already join it. */
  static final double EARLY_JOIN = 1.0;

  private static final double MAX_SIDE_SPEED = 0.02;
  private static final double MAX_FORWARD_SPEED = MovementMotor.SPRINT_SPEED + 0.02;

  /** Pure pursuit aims this far ahead on the run-up line, so cross-track decays smoothly. */
  private static final double JOIN_LOOKAHEAD = 0.8;

  /** Runway a stationary body needs to reach launch momentum under sprint acceleration. */
  private static final double ACCELERATION_RUNWAY = 1.4;

  /** Runway kept in reserve for the final launch-window samples. */
  private static final double WINDOW_RUNWAY = 0.4;

  /** A joining body may still be turning onto the line, but not sliding across it. */
  private static final double MAX_JOIN_SIDE_SPEED = 0.15;

  /** Forward speed along the line that counts as running up it rather than standing on it. */
  private static final double RUNNING_SPEED = MovementMotor.WALK_SPEED;

  private JumpController() {}

  public record Step(Optional<ActiveJump> state, Vec3 moveTo, boolean jump, boolean failed) {}

  public record Request(Waypoint waypoint, ActiveJump.Intent intent) {}

  /** A body's position and motion measured against one launch's run-up line. */
  private record Line(
      JumpLaunch launch, Vec3 direction, double along, double cross, double momentum, double side) {
    static Line of(JumpLaunch launch, CombatantView self) {
      var direction = launch.takeoff().minus(launch.runUpStart()).horizontal().normalized();
      var offset = self.pos().minus(launch.takeoff()).horizontal();
      var along = offset.dot(direction);
      var velocity = self.vel().horizontal();
      var momentum = velocity.dot(direction);
      return new Line(
          launch,
          direction,
          along,
          offset.minus(direction.scale(along)).length(),
          momentum,
          velocity.minus(direction.scale(momentum)).length());
    }

    double length() {
      return launch.takeoff().horizontalDistance(launch.runUpStart());
    }

    boolean level(CombatantView self) {
      return Math.abs(self.pos().y() - launch.takeoff().y()) <= MAX_HEIGHT_ERROR;
    }
  }

  public static Step tick(
      Optional<ActiveJump> previous, Request request, CombatantView self, long now) {
    var waypoint = request.waypoint();
    // A replanned route that still holds this launch keeps its preparation: only the record of
    // what the route is for follows the new decision, so a moved goal never restarts a run-up.
    var active =
        previous
            .filter(value -> value.waypoint().equals(waypoint))
            .map(value -> value.withIntent(request.intent()))
            .orElseGet(
                () ->
                    new ActiveJump(waypoint, request.intent(), ActiveJump.Stage.APPROACH, now, -1));
    if (WaypointArrival.reached(self, waypoint))
      return new Step(Optional.empty(), self.pos(), false, false);
    if (now - active.startedTick() > 120)
      return new Step(Optional.empty(), self.pos(), false, true);
    if (active.stage() == ActiveJump.Stage.AIRBORNE) return airborne(active, self, now);
    return grounded(active, self, now);
  }

  /**
   * The waypoint to follow instead of {@code index}: the sprint jump after it when {@code index} is
   * the walk to its takeoff node and the body may already join its run-up, since braking onto that
   * node leaves no runway; otherwise {@code index} itself.
   */
  public static int joinedLeap(List<Waypoint> waypoints, int index, CombatantView self) {
    if (index + 1 >= waypoints.size()
        || waypoints.get(index).hop() != Hop.WALK
        || !self.traversal().maySprint()) return index;
    var next = waypoints.get(index + 1);
    return next.hop() == Hop.LEAP && joinsRunUp(next, self) ? index + 1 : index;
  }

  /**
   * Whether a grounded body behind the takeoff, near the run-up line and not moving backwards, has
   * the runway to reach the launch window with the measured momentum without backing up.
   */
  public static boolean joinsRunUp(Waypoint waypoint, CombatantView self) {
    if (!self.onGround() || waypoint.launch().isEmpty()) return false;
    var line = Line.of(waypoint.launch().orElseThrow(), self);
    return line.level(self) && joins(line, EARLY_JOIN);
  }

  /**
   * Whether a grounded body up to {@code reach} blocks behind the run-up start is already running
   * up the run-up line, so carrying on straight would join the run-up rather than back up to it.
   */
  public static boolean runningAt(JumpLaunch launch, CombatantView self, double reach) {
    if (!self.onGround()) return false;
    var line = Line.of(launch, self);
    return line.level(self) && line.momentum() >= RUNNING_SPEED && joins(line, reach);
  }

  private static boolean joins(Line line) {
    return joins(line, EARLY_JOIN);
  }

  private static boolean joins(Line line, double reach) {
    if (line.cross() > MAX_JOIN_CROSS
        || line.along() < -(line.length() + reach)
        || line.momentum() < 0
        || line.momentum() > MAX_FORWARD_SPEED
        || line.side() > MAX_JOIN_SIDE_SPEED) return false;
    var accelerate =
        ACCELERATION_RUNWAY * Math.clamp(1 - line.momentum() / line.launch().minimumSpeed(), 0, 1);
    // Pure pursuit shrinks the cross-track by e every lookahead travelled.
    var close =
        line.cross() > MAX_CROSS_TRACK
            ? JOIN_LOOKAHEAD * Math.log(line.cross() / (0.8 * MAX_CROSS_TRACK))
            : 0;
    return -line.along() >= WINDOW_RUNWAY + Math.max(accelerate, close);
  }

  /** The run-up line point a joining body steers at: never behind its start nor past takeoff. */
  private static Vec3 joinPoint(Line line) {
    var aim = Math.clamp(line.along() + JOIN_LOOKAHEAD, -line.length(), 0);
    return line.launch().takeoff().plus(line.direction().scale(aim));
  }

  /** On the measured runway, where the body's run-up gate accepts sprint input. */
  private static boolean onRunway(Line line) {
    return line.along() >= -line.length() - RUN_UP_START_REACH
        && line.cross() <= MAX_CROSS_TRACK
        && line.side() <= MAX_SIDE_SPEED
        && line.momentum() <= MAX_FORWARD_SPEED;
  }

  private static Step airborne(ActiveJump active, CombatantView self, long now) {
    // A canceled launch or an off-target landing cannot authorize walking an airborne primitive.
    // A body touching down whose fall the server has not yet settled has not finished landing:
    // judging it then failed on-target landings, by launch phase, a tick before arrival counts.
    if (now > active.launchTick()
        && self.onGround()
        && self.vel().y() <= 0
        && self.traversal().fallDistance() == 0)
      return new Step(Optional.empty(), self.pos(), false, true);
    return new Step(Optional.of(active), active.waypoint().pos(), false, false);
  }

  private static Step grounded(ActiveJump active, CombatantView self, long now) {
    var launch = active.waypoint().launch().orElseThrow();
    if (!self.onGround()) return new Step(Optional.empty(), active.waypoint().pos(), false, true);
    if (active.stage() == ActiveJump.Stage.BACKUP) {
      if (self.pos().horizontalDistance(launch.runUpStart()) > RUN_UP_START_REACH)
        return new Step(Optional.of(active), launch.runUpStart(), false, false);
      active = active.stage(ActiveJump.Stage.RUN_UP, now);
    } else if (active.stage() == ActiveJump.Stage.APPROACH) {
      var line = Line.of(launch, self);
      if (line.level(self)
          && onRunway(line)
          && (line.momentum() >= launch.minimumSpeed() || joins(line))) {
        // Already running the measured line: the run-up is under way, not about to begin.
        active = active.stage(ActiveJump.Stage.RUN_UP, now);
      } else if (line.level(self) && joins(line)) {
        return new Step(Optional.of(active), joinPoint(line), false, false);
      }
    }
    return launchReady(active, self, now);
  }

  private static Step launchReady(ActiveJump active, CombatantView self, long now) {
    var launch = active.waypoint().launch().orElseThrow();
    var direction = launch.takeoff().minus(launch.runUpStart()).horizontal().normalized();
    var along = self.pos().minus(launch.takeoff()).dot(direction);
    var momentum = self.vel().horizontal().dot(direction);
    if (Math.abs(self.pos().y() - launch.takeoff().y()) > MAX_HEIGHT_ERROR)
      return new Step(Optional.empty(), self.pos(), false, true);
    if (offCorridor(self, launch.takeoff(), direction) || excessiveMomentum(self, direction))
      return backup(active);
    if (along >= MIN_LAUNCH_ALONG && along <= MAX_LAUNCH_ALONG && momentum >= launch.minimumSpeed())
      return new Step(
          Optional.of(active.stage(ActiveJump.Stage.AIRBORNE, now)),
          active.waypoint().pos(),
          true,
          false);
    if (along > MAX_LAUNCH_ALONG
        || (along >= -0.8
            && momentum < launch.minimumSpeed()
            && (active.stage() != ActiveJump.Stage.RUN_UP || along >= MIN_LAUNCH_ALONG)))
      return backup(active);
    // A destination at takeoff brakes the native motor just before the measured launch window.
    // Keep forward input for its final sprint step; the body still certifies that grounded step.
    if (active.stage() == ActiveJump.Stage.RUN_UP && along >= -MovementMotor.SPRINT_SPEED)
      return new Step(Optional.of(active), active.waypoint().pos(), false, false);
    return new Step(Optional.of(active), launch.takeoff(), false, false);
  }

  private static boolean offCorridor(CombatantView self, Vec3 takeoff, Vec3 direction) {
    var offset = self.pos().minus(takeoff).horizontal();
    return offset.minus(direction.scale(offset.dot(direction))).length() > MAX_CROSS_TRACK;
  }

  private static boolean excessiveMomentum(CombatantView self, Vec3 direction) {
    var velocity = self.vel().horizontal();
    var forward = velocity.dot(direction);
    return forward > MAX_FORWARD_SPEED
        || velocity.minus(direction.scale(forward)).length() > MAX_SIDE_SPEED;
  }

  private static Step backup(ActiveJump active) {
    return new Step(
        Optional.of(active.stage(ActiveJump.Stage.BACKUP, active.startedTick())),
        active.waypoint().launch().orElseThrow().runUpStart(),
        false,
        false);
  }
}
