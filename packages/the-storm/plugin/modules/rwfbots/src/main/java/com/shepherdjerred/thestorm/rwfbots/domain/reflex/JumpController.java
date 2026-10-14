package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.Optional;

/** Executes the actual baked run-up and minimum forward momentum before issuing a sprint jump. */
public final class JumpController {
  static final double MAX_CROSS_TRACK = 0.05;
  static final double MAX_HEIGHT_ERROR = 0.05;
  static final double MIN_LAUNCH_ALONG = -0.1;
  static final double MAX_LAUNCH_ALONG = 0.18;
  static final double RUN_UP_START_REACH = 0.2;
  private static final double MAX_SIDE_SPEED = 0.02;
  private static final double MAX_FORWARD_SPEED = MovementMotor.SPRINT_SPEED + 0.02;

  private JumpController() {}

  public record Step(Optional<ActiveJump> state, Vec3 moveTo, boolean jump, boolean failed) {}

  public record Request(Waypoint waypoint, ActiveJump.Intent intent) {}

  public static Step tick(
      Optional<ActiveJump> previous, Request request, CombatantView self, long now) {
    var waypoint = request.waypoint();
    var active =
        previous
            .filter(
                value ->
                    value.waypoint().equals(waypoint) && value.intent().equals(request.intent()))
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

  private static Step airborne(ActiveJump active, CombatantView self, long now) {
    // A canceled launch or an off-target landing cannot authorize walking an airborne primitive.
    if (now > active.launchTick() && self.onGround() && self.vel().y() <= 0)
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
