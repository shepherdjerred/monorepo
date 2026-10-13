package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.JumpLaunch;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.BitSet;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class ReflexJumpCommitmentTest {
  private static final Waypoint ORIGINAL = leap(1.5, 1);
  private static final Waypoint REPLANNED = leap(2.5, 1);
  private static final Waypoint GOAL = new Waypoint(new Vec3(10.5, 1, 1.5), Hop.WALK);
  private static final ReflexContext CONTEXT =
      new ReflexContext(
          new VoxelGrid(
              new GridBounds(new BlockPos(0, 0, 0), 16, 16, 8),
              new BitSet(),
              new BitSet(),
              new BitSet()),
          levers(1),
          Loadout.standard(Kit.TROOPER));

  @Test
  void preparedBackupAndRunUpKeepTheirOriginalLaunchAcrossSameGoalRowChanges() {
    var self = combatant(1, RED, new Vec3(1.5, 1, 1.5));
    for (var stage : List.of(ActiveJump.Stage.BACKUP, ActiveJump.Stage.RUN_UP)) {
      var active = active(ORIGINAL, stage);
      var step = tick(self, active, route(Option.HUNT, GOAL), 10);
      assertThat(step.state().activeJump()).contains(active);
      var expected =
          stage == ActiveJump.Stage.BACKUP
              ? ORIGINAL.launch().orElseThrow().runUpStart()
              : ORIGINAL.launch().orElseThrow().takeoff();
      assertThat(step.commands()).contains(new BodyCommand.MoveToward(expected, true));
      assertThat(step.commands()).doesNotContain(new BodyCommand.Jump());
    }
  }

  @Test
  void aDifferentFinalGoalOrOrderReplacesPreparationWithTheNewLaunch() {
    var self = combatant(1, RED, new Vec3(1.5, 1, 1.5));
    var changedGoal = new Waypoint(GOAL.pos().plus(0, 0, 1), Hop.WALK);
    for (var decision : List.of(route(Option.HUNT, changedGoal), route(Option.RETAKE, GOAL))) {
      var step = tick(self, active(ORIGINAL, ActiveJump.Stage.BACKUP), decision, 10);
      assertThat(step.state().activeJump())
          .hasValueSatisfying(
              next -> {
                assertThat(next.waypoint()).isEqualTo(REPLANNED);
                assertThat(next.intent())
                    .isEqualTo(
                        new ActiveJump.Intent(
                            decision.option(), decision.waypoints().getLast().pos()));
                assertThat(next.startedTick()).isEqualTo(10);
              });
      assertThat(step.commands())
          .doesNotContain(
              new BodyCommand.MoveToward(ORIGINAL.launch().orElseThrow().runUpStart(), true));
    }
  }

  @Test
  void airborneCommitmentKeepsItsLandingEvenWhenTheOrderAndGoalChange() {
    var self = combatant(1, RED, new Vec3(4.5, 2, 1.5)).withMotion(true, false);
    var active = active(ORIGINAL, ActiveJump.Stage.AIRBORNE);
    var changed = route(Option.RETAKE, new Waypoint(GOAL.pos().plus(0, 0, 1), Hop.WALK));
    var step = tick(self, active, changed, 10);
    assertThat(step.state().activeJump()).contains(active);
    assertThat(step.commands()).contains(new BodyCommand.MoveToward(ORIGINAL.pos(), true));
    assertThat(step.commands()).doesNotContain(new BodyCommand.Jump());
  }

  @Test
  void currentHealthLossRefusesAPreviouslyAffordableDamagingLaunch() {
    var jump = leap(1.5, 8);
    var self = atTakeoff(jump);
    var active = active(jump, ActiveJump.Stage.RUN_UP);
    assertThat(tick(self, active, route(Option.HUNT, GOAL), 10).commands())
        .contains(new BodyCommand.Jump());
    var refused = tick(self.withHealth(6, 0), active, route(Option.HUNT, GOAL), 10);
    assertRefused(refused);
  }

  @Test
  void protectionMustLastThroughLandingAfterTheRunUpDelay() {
    var jump = leap(1.5, 8);
    var protection = new TraversalState(true, 3, 1, 0, -1, -1, 25, -1, 0, -1, -1, -1, -1, 20);
    var self = atTakeoff(jump).withTraversal(protection).withHealth(3, 0);
    var active = active(jump, ActiveJump.Stage.RUN_UP);
    assertThat(tick(self, active, route(Option.HUNT, GOAL), 8).commands())
        .contains(new BodyCommand.Jump());
    // The effect is still active now, but expires before the delayed launch would land.
    assertRefused(tick(self, active, route(Option.HUNT, GOAL), 12));
  }

  private static void assertRefused(Reflex.Step step) {
    assertThat(step.state().activeJump()).isEmpty();
    assertThat(step.commands()).contains(new BodyCommand.Stop());
    assertThat(step.commands()).doesNotContain(new BodyCommand.Jump());
    assertThat(step.commands()).noneMatch(BodyCommand.MoveToward.class::isInstance);
  }

  private static Waypoint leap(double z, double startY) {
    return new Waypoint(
        new Vec3(6.5, 1, z),
        Hop.LEAP,
        Optional.of(new JumpLaunch(new Vec3(2.7, startY, z), new Vec3(0.7, startY, z), 0.27, 13)));
  }

  private static CombatantView atTakeoff(Waypoint jump) {
    return combatant(1, RED, jump.launch().orElseThrow().takeoff()).withVel(new Vec3(0.28, 0, 0));
  }

  private static ActiveJump active(Waypoint jump, ActiveJump.Stage stage) {
    return new ActiveJump(
        jump,
        new ActiveJump.Intent(Option.HUNT, GOAL.pos()),
        stage,
        1,
        stage == ActiveJump.Stage.AIRBORNE ? 2 : -1);
  }

  private static Decision route(Option option, Waypoint goal) {
    return new Decision(
        combatant(1, RED, Vec3.ZERO).id(),
        option,
        Optional.empty(),
        List.of(REPLANNED, goal),
        Stance.AGGRESSIVE,
        Optional.empty(),
        Optional.empty(),
        Optional.empty(),
        "replanned",
        10,
        1);
  }

  private static Reflex.Step tick(
      CombatantView self, ActiveJump active, Decision decision, long now) {
    var world =
        new WorldSnapshot(
            now,
            MatchPhase.LIVE,
            List.of(self),
            List.of(),
            PoisonView.NONE,
            "jump-test",
            List.of());
    return Reflex.tick(
        ReflexState.initial(self.facing()).withActiveJump(Optional.of(active)),
        new ReflexInput(self, world, decision, Optional.empty(), 0),
        CONTEXT,
        new SplittableRandom(196));
  }
}
