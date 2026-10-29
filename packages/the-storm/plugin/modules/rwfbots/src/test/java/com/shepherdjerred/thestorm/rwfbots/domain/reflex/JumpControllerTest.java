package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.JumpLaunch;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState;
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
  void aStationaryBotWithoutRunwayBacksUpBeforeBuildingTheMeasuredLaunchMomentum() {
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
  void aBotSprintingAlongTheRunUpLineRunsStraightIntoTheLaunch() {
    var running =
        combatant(1, RED, new Vec3(1.7, 1, 1.5))
            .withVel(new Vec3(0.28, 0, 0))
            .withFacing(new Facing(-90, 0));
    assertThat(JumpController.joinsRunUp(GAP, running)).isTrue();
    var step = JumpController.tick(Optional.empty(), REQUEST, running, 1);
    assertThat(step.state().orElseThrow().stage()).isEqualTo(ActiveJump.Stage.RUN_UP);
    assertThat(step.moveTo()).isEqualTo(GAP.launch().orElseThrow().takeoff());
    var launched =
        JumpController.tick(step.state(), REQUEST, running.withPos(new Vec3(2.75, 1, 1.5)), 5);
    assertThat(launched.jump()).isTrue();
  }

  @Test
  void aForwardApproachSlightlyOffTheLineSteersOntoItInsteadOfBackingUp() {
    var approaching = combatant(1, RED, new Vec3(0.5, 1, 1.75)).withVel(new Vec3(0.28, 0, -0.02));
    assertThat(JumpController.joinsRunUp(GAP, approaching)).isTrue();
    var step = JumpController.tick(Optional.empty(), REQUEST, approaching, 1);
    assertThat(step.jump()).isFalse();
    assertThat(step.state().orElseThrow().stage()).isEqualTo(ActiveJump.Stage.APPROACH);
    // Pure pursuit: a point on the run-up line ahead of the body, never the run-up start behind.
    assertThat(step.moveTo().z()).isEqualTo(1.5);
    assertThat(step.moveTo().x()).isGreaterThan(approaching.pos().x());
  }

  @Test
  void sideStalledAndOvershootingApproachesStillBackUpToTheRunUpStart() {
    var start = GAP.launch().orElseThrow().runUpStart();
    for (var self :
        java.util.List.of(
            // From the side: too far off the line to close before the launch window.
            combatant(1, RED, new Vec3(1.7, 1, 2.3)).withVel(new Vec3(0.28, 0, 0)),
            // Sliding across the line rather than running along it.
            combatant(1, RED, new Vec3(1.2, 1, 1.6)).withVel(new Vec3(0.05, 0, -0.28)),
            // Already past the launch window.
            combatant(1, RED, new Vec3(3.0, 1, 1.5)).withVel(new Vec3(0.28, 0, 0)),
            // Too close to build launch speed from a stand.
            combatant(1, RED, new Vec3(2.2, 1, 1.5)))) {
      assertThat(JumpController.joinsRunUp(GAP, self)).as("%s", self.pos()).isFalse();
      var step = JumpController.tick(Optional.empty(), REQUEST, self, 1);
      assertThat(step.state().orElseThrow().stage())
          .as("%s", self.pos())
          .isEqualTo(ActiveJump.Stage.BACKUP);
      assertThat(step.moveTo()).isEqualTo(start);
    }
  }

  @Test
  void aReplanThatKeepsTheLaunchOnTheRouteKeepsTheRunUpUnderWay() {
    var running = combatant(1, RED, new Vec3(1.7, 1, 1.5)).withVel(new Vec3(0.28, 0, 0));
    var underWay = new ActiveJump(GAP, INTENT, ActiveJump.Stage.RUN_UP, 1, -1);
    var movedGoal = new ActiveJump.Intent(Option.HUNT, GAP.pos().plus(0, 0, 3));
    var step =
        JumpController.tick(
            Optional.of(underWay), new JumpController.Request(GAP, movedGoal), running, 4);
    assertThat(step.state())
        .hasValueSatisfying(
            next -> {
              assertThat(next.stage()).isEqualTo(ActiveJump.Stage.RUN_UP);
              assertThat(next.startedTick()).isEqualTo(1);
              assertThat(next.intent()).isEqualTo(movedGoal);
            });
    assertThat(step.moveTo()).isEqualTo(GAP.launch().orElseThrow().takeoff());
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
  void aTouchdownWhoseFallTheServerHasNotSettledIsNotYetAMissedLanding() {
    var active = new ActiveJump(GAP, INTENT, ActiveJump.Stage.AIRBORNE, 1, 1);
    // Short of the waypoint's arrival radius only until the landing tick's own motion completes.
    var touching =
        combatant(1, RED, new Vec3(6.0, 1, 1.5))
            .withVel(new Vec3(0.28, 0, 0))
            .withTraversal(TraversalState.UNMODIFIED.withFallDistance(0.4));
    var step = JumpController.tick(Optional.of(active), REQUEST, touching, 12);
    assertThat(step.failed()).isFalse();
    assertThat(step.state()).contains(active);
    var settled =
        touching.withPos(GAP.pos()).withTraversal(TraversalState.UNMODIFIED.withFallDistance(0));
    var landed = JumpController.tick(step.state(), REQUEST, settled, 13);
    assertThat(landed.state()).isEmpty();
    assertThat(landed.failed()).isFalse();
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
