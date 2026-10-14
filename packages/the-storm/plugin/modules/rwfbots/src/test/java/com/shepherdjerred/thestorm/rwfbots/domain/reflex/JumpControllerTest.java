package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.JumpLaunch;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class JumpControllerTest {
  private static final Waypoint GAP =
      new Waypoint(
          new Vec3(6.5, 1, 1.5),
          Hop.LEAP,
          Optional.of(new JumpLaunch(new Vec3(2.7, 1, 1.5), new Vec3(0.7, 1, 1.5), 0.27, 13)));
  private static final ActiveJump.Intent INTENT = new ActiveJump.Intent(Option.HUNT, GAP.pos());
  private static final JumpController.Request REQUEST = new JumpController.Request(GAP, INTENT);

  @Test
  void aStationaryBotBacksUpBeforeBuildingTheMeasuredLaunchMomentum() {
    var self = combatant(1, RED, new Vec3(2.5, 1, 1.5));
    var backup = JumpController.tick(Optional.empty(), REQUEST, self, 1);
    assertThat(backup.jump()).isFalse();
    assertThat(backup.state().orElseThrow().stage()).isEqualTo(ActiveJump.Stage.BACKUP);
    assertThat(backup.moveTo()).isEqualTo(GAP.launch().orElseThrow().runUpStart());
    var run = JumpController.tick(backup.state(), REQUEST, self.withPos(backup.moveTo()), 8);
    assertThat(run.state().orElseThrow().stage()).isEqualTo(ActiveJump.Stage.RUN_UP);
    var moving =
        self.withPos(new Vec3(2.75, 1, 1.5))
            .withVel(new Vec3(0.28, 0, 0))
            .withFacing(new Facing(90, 0));
    var launched = JumpController.tick(run.state(), REQUEST, moving, 16);
    assertThat(launched.jump()).isTrue();
    assertThat(launched.state().orElseThrow().launchTick()).isEqualTo(16);
  }

  @Test
  void displacementOrKnockbackCannotLaunchOutsideTheMeasuredCorridor() {
    var at = GAP.launch().orElseThrow().takeoff();
    var aligned = combatant(1, RED, at).withVel(new Vec3(0.28, 0, 0));
    for (var shifted :
        java.util.List.of(
            aligned.withPos(at.plus(0, 0, 1)),
            aligned.withVel(new Vec3(0.28, 0, 2)),
            aligned.withVel(new Vec3(2, 0, 0)))) {
      var step = JumpController.tick(Optional.empty(), REQUEST, shifted, 1);
      assertThat(step.jump()).isFalse();
      assertThat(step.state().orElseThrow().stage()).isEqualTo(ActiveJump.Stage.BACKUP);
    }
    var wrongFloor =
        JumpController.tick(Optional.empty(), REQUEST, aligned.withPos(at.plus(0, 1, 0)), 1);
    assertThat(wrongFloor.jump()).isFalse();
    assertThat(wrongFloor.failed()).isTrue();
  }

  @Test
  void anAirbornePrimitiveKeepsItsLandingAndCompletesOnlyAtTheDestination() {
    var active = new ActiveJump(GAP, INTENT, ActiveJump.Stage.AIRBORNE, 1, 1);
    var flying = combatant(1, RED, new Vec3(4.5, 2.2, 1.5)).withMotion(true, false);
    var next = JumpController.tick(Optional.of(active), REQUEST, flying, 5);
    assertThat(next.moveTo()).isEqualTo(GAP.pos());
    assertThat(next.jump()).isFalse();
    assertThat(next.state()).contains(active);
    var landed =
        JumpController.tick(
            next.state(), REQUEST, flying.withPos(GAP.pos()).withMotion(false, true), 13);
    assertThat(landed.state()).isEmpty();
    assertThat(landed.failed()).isFalse();
  }

  @Test
  void aLaterGroundedSnapshotRejectsAnUnexecutedLaunchOrAnOffTargetLanding() {
    var active = new ActiveJump(GAP, INTENT, ActiveJump.Stage.AIRBORNE, 1, 1);
    for (var self :
        java.util.List.of(
            combatant(1, RED, GAP.launch().orElseThrow().takeoff()),
            combatant(1, RED, new Vec3(5.5, 1, 1.5)).withVel(new Vec3(0.28, -0.01, 0)))) {
      var step = JumpController.tick(Optional.of(active), REQUEST, self, 2);
      assertThat(step.state()).isEmpty();
      assertThat(step.failed()).isTrue();
      assertThat(step.jump()).isFalse();
      assertThat(step.moveTo()).isEqualTo(self.pos());
    }
  }

  @Test
  void theLaunchFrameAndActualAscendingOrDescendingFlightRetainLandingOwnership() {
    var active = new ActiveJump(GAP, INTENT, ActiveJump.Stage.AIRBORNE, 1, 1);
    var atTakeoff = combatant(1, RED, GAP.launch().orElseThrow().takeoff());
    var first = JumpController.tick(Optional.of(active), REQUEST, atTakeoff, 1);
    assertThat(first.state()).contains(active);
    assertThat(first.failed()).isFalse();
    for (var self :
        java.util.List.of(
            atTakeoff.withVel(new Vec3(0.48, MovementMotor.JUMP_SPEED, 0)),
            atTakeoff
                .withPos(new Vec3(4.5, 2.2, 1.5))
                .withMotion(true, false)
                .withVel(new Vec3(0.3, -0.1, 0)))) {
      var step = JumpController.tick(Optional.of(active), REQUEST, self, 2);
      assertThat(step.state()).contains(active);
      assertThat(step.failed()).isFalse();
      assertThat(step.jump()).isFalse();
      assertThat(step.moveTo()).isEqualTo(GAP.pos());
    }
  }

  @Test
  void oneBlockVerticalWaypointsCannotBeSkippedBeforeTheirMotionHappens() {
    var self = combatant(1, RED, new Vec3(2.5, 1, 1.5));
    assertThat(WaypointArrival.reached(self, new Waypoint(new Vec3(2.5, 2, 1.5), Hop.SWIM)))
        .isFalse();
    assertThat(WaypointArrival.reached(self, new Waypoint(new Vec3(2.5, 2, 1.5), Hop.CLIMB)))
        .isFalse();
    assertThat(WaypointArrival.reached(self, new Waypoint(new Vec3(2.7, 2, 1.5), Hop.JUMP)))
        .isFalse();
  }
}
