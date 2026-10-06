package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class TacticsCommitmentTest {
  private static final NavArtifact NAV = SyntheticMap.bake();
  private static final Vec3 SELF = new Vec3(5.5, 1, 5.5);
  private static final Optional<Plan> ROUTE =
      Optional.of(
          Plan.of(
              Option.TAKE_SLOT, 0, new PlanStep.Route(new Vec3(25.5, 1, 15.5), Stance.AGGRESSIVE)));

  private static Situation situation(Role role, double enemyDistance, long hurtTick) {
    var self = combatant(1, RED, SELF).withLastHurtTick(hurtTick);
    var enemy = combatant(2, BLUE, SELF.plus(enemyDistance, 0, 0));
    var snapshot =
        new WorldSnapshot(
            100,
            MatchPhase.LIVE,
            List.of(self, enemy),
            List.of(),
            PoisonView.NONE,
            "synthetic",
            List.of());
    return new Situation(
        self,
        snapshot,
        new Percept(PerceptionState.EMPTY, List.of(enemy), 100),
        Blackboard.open(RED, Strategy.RUSH),
        role);
  }

  @Test
  void aFlankCompletesItsRouteInsteadOfJoiningDistantFightsOrTheSameBomb() {
    for (var picked : List.of(Option.HUNT, Option.ENGAGE, Option.ARM, Option.HELP_ARM)) {
      assertThat(Tactics.choose(picked, ROUTE, situation(Role.ROTATE, 20, -1), Map.of()))
          .as("distant detour %s", picked)
          .isEqualTo(Option.TAKE_SLOT);
    }
  }

  @Test
  void closeContactAndRecentDamageMayInterruptTheFlank() {
    assertThat(Tactics.choose(Option.ENGAGE, ROUTE, situation(Role.ROTATE, 3, -1), Map.of()))
        .isEqualTo(Option.ENGAGE);
    assertThat(Tactics.choose(Option.ENGAGE, ROUTE, situation(Role.ROTATE, 20, 95), Map.of()))
        .isEqualTo(Option.ENGAGE);
  }

  @Test
  void survivalAndDefusingStillOverrideTheFlank() {
    for (var picked : List.of(Option.DEFUSE, Option.ESCAPE_POISON, Option.HEAL, Option.RETREAT)) {
      assertThat(Tactics.choose(picked, ROUTE, situation(Role.ROTATE, 20, -1), Map.of()))
          .as("urgent option %s", picked)
          .isEqualTo(picked);
    }
  }

  @Test
  void anEscortMayHelpAtTheBombWhileTraveling() {
    assertThat(Tactics.choose(Option.HELP_ARM, ROUTE, situation(Role.ESCORT, 20, -1), Map.of()))
        .isEqualTo(Option.HELP_ARM);
  }

  private static Thought afterBombChange(Option option, PlanStep action, BombView bomb) {
    var self = combatant(1, RED, SELF);
    var plan =
        Plan.of(option, 90, new PlanStep.Route(new Vec3(30.5, 1, 10.5), Stance.CAUTIOUS), action);
    var snapshot =
        new WorldSnapshot(
            100,
            MatchPhase.LIVE,
            List.of(self),
            List.of(bomb),
            PoisonView.NONE,
            NAV.mapId(),
            List.of());
    return Tactics.think(
        new TacticsState(Optional.of(plan), 90, 0, 0, RewindClock.UNSTARTED),
        new Situation(
            self,
            snapshot,
            new Percept(PerceptionState.EMPTY, List.of(), 100),
            Blackboard.open(RED, Strategy.RUSH),
            Role.ROTATE),
        new TacticsContext(
            NAV,
            levers(1),
            new Style(0.5, 0.5, 0.5, 0.5),
            Kit.TROOPER,
            Archetype.TACTICIAN,
            Set.of(),
            42),
        new SplittableRandom(1));
  }

  @Test
  void aRouteToArmIsDroppedWhenTheBombHasAlreadyBeenArmed() {
    var id = new BombId(1);
    var bomb =
        new BombView(
            id, new BombOwner.Team(BLUE), new Vec3(30.5, 1, 10.5), new BombState.Armed(100));
    assertThat(afterBombChange(Option.ARM, new PlanStep.Arm(id), bomb).decision().option())
        .isEqualTo(Option.HOLD_ANGLE);
  }

  @Test
  void aRouteToDefuseIsDroppedWhenTheFuseIsNoLongerLit() {
    var id = new BombId(1);
    var bomb =
        new BombView(id, new BombOwner.Team(RED), new Vec3(30.5, 1, 10.5), new BombState.Idle());
    assertThat(afterBombChange(Option.DEFUSE, new PlanStep.Defuse(id), bomb).decision().option())
        .isEqualTo(Option.HOLD_ANGLE);
  }
}
