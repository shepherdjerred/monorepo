package com.shepherdjerred.thestorm.rwfbots.sim;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ActiveJump;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.JumpController;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.JumpLaunch;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** Controller, calibrated motor, ground drag and displacement snapshots form one feedback loop. */
final class JumpRunUpFeedbackTest {
  private static final double MEASURED_MINIMUM = 0.27000001072883606;
  private static final SimPhysics PHYSICS = new SimPhysics(SyntheticMap.bake());

  @Test
  void stalledDiagonalRunUpsRecoverAndLaunchWithActualMomentumInBothDirections() {
    for (var waypoint : List.of(diagonal(1), diagonal(-1))) {
      var body = body(waypoint.launch().orElseThrow().takeoff());
      var active = active(waypoint);
      var first = JumpController.tick(Optional.of(active), request(active), body.view(0), 1);
      assertThat(first.state().orElseThrow().stage()).isEqualTo(ActiveJump.Stage.BACKUP);
      assertThat(first.jump()).isFalse();
      assertThat(first.moveTo()).isEqualTo(waypoint.launch().orElseThrow().runUpStart());
      assertThat(launch(body, active)).isBetween(2L, 120L);
    }
  }

  @Test
  void theFinalApproachDoesNotBrakeAtTakeoffWhenMotorArrivalFallsBetweenLaunchSamples() {
    var waypoint = diagonal(1);
    var takeoff = waypoint.launch().orElseThrow().takeoff();
    var direction = takeoff.minus(waypoint.launch().orElseThrow().runUpStart()).normalized();
    var body = body(takeoff.minus(direction.scale(0.23)));
    // Momentum is built by the same motor/physics loop, never supplied to the controller.
    assertThat(body.view(0).vel()).isEqualTo(Vec3.ZERO);
    assertThat(launch(body, active(waypoint))).isBetween(2L, 120L);
  }

  private static long launch(SimBody body, ActiveJump initial) {
    var state = Optional.of(initial);
    var launch = initial.waypoint().launch().orElseThrow();
    var direction = launch.takeoff().minus(launch.runUpStart()).normalized();
    for (var tick = 1L; tick <= 120; tick++) {
      var snapshot = body.view(tick);
      var step = JumpController.tick(state, request(initial), snapshot, tick);
      assertThat(step.failed()).isFalse();
      state = step.state();
      body.sprinting = true;
      PHYSICS.steer(body, step.moveTo().minus(body.pos));
      if (step.jump()) {
        assertThat(snapshot.onGround()).isTrue();
        assertThat(snapshot.vel().dot(direction)).isGreaterThanOrEqualTo(MEASURED_MINIMUM);
        assertThat(snapshot.pos().minus(launch.takeoff()).dot(direction)).isBetween(-0.1, 0.18);
        PHYSICS.jump(body, tick);
        move(body, tick);
        assertThat(body.onGround).isFalse();
        assertThat(body.pos.y()).isGreaterThan(launch.takeoff().y());
        var airborne = JumpController.tick(state, request(initial), body.view(tick + 1), tick + 1);
        assertThat(airborne.jump()).isFalse();
        assertThat(airborne.moveTo()).isEqualTo(initial.waypoint().pos());
        return tick;
      }
      move(body, tick);
      assertThat(body.onGround).isTrue();
    }
    throw new AssertionError("Measured run-up did not launch within its original timeout");
  }

  private static void move(SimBody body, long tick) {
    body.previousPos = body.pos;
    PHYSICS.move(body, tick);
  }

  private static SimBody body(Vec3 at) {
    return new SimBody(new SimWorld.Spawn(1, Fixtures.RED, Kit.TROOPER, at));
  }

  private static JumpController.Request request(ActiveJump active) {
    return new JumpController.Request(active.waypoint(), active.intent());
  }

  private static ActiveJump active(Waypoint waypoint) {
    return new ActiveJump(
        waypoint,
        new ActiveJump.Intent(Option.HUNT, waypoint.pos()),
        ActiveJump.Stage.RUN_UP,
        0,
        -1);
  }

  private static Waypoint diagonal(int sign) {
    var takeoff = new Vec3(5.5 + sign * 0.141421, 1, 7.5 + sign * 0.141421);
    var direction = new Vec3(sign, 0, sign).normalized();
    return new Waypoint(
        sign > 0 ? new Vec3(8.5, 1, 10.5) : new Vec3(1.5, 1, 3.5),
        Hop.LEAP,
        Optional.of(
            new JumpLaunch(takeoff, takeoff.minus(direction.scale(2)), MEASURED_MINIMUM, 13)));
  }
}
