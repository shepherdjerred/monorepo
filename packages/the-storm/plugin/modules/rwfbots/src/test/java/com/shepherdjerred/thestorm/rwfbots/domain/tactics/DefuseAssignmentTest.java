package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Slot;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotKind;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.team.TeamPlan;
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

final class DefuseAssignmentTest {
  @Test
  void lateWorkersImmediatelyRouteToTheirSeparateCertifiedFusePositions() {
    var nav = SyntheticMap.bake();
    var site = nav.sites().bombs().getFirst();
    var workers = nav.bombScreens().require(site.name()).workers();
    assertThat(workers).hasSizeGreaterThanOrEqualTo(2);
    var bomb =
        new BombView(
            new BombId(1),
            new BombOwner.Team(Fixtures.RED),
            site.cell().center(),
            new BombState.Armed(100));
    var context =
        new TacticsContext(
            nav,
            Fixtures.levers(1),
            new Style(.5, .5, .5, .5),
            Kit.TROOPER,
            Archetype.TACTICIAN,
            Set.of(Quirk.LATE_TO_EVERYTHING),
            42,
            null);
    for (var index = 0; index < 2; index++) {
      var self = Fixtures.combatant(index + 1, Fixtures.RED, SyntheticMap.RED_SPAWN.feet());
      var slot =
          new Slot(
              "defuse-" + index,
              SlotKind.ANCHOR,
              Role.RETAKE,
              nav.graph().feet(workers.get(index)),
              bomb.pos(),
              -1,
              0,
              Optional.empty(),
              0);
      var plan =
          new TeamPlan(
              Optional.of(Strategy.RUSH),
              Optional.empty(),
              Optional.of(bomb.id()),
              List.of(),
              0,
              List.of(slot),
              Map.of(self.id(), slot.key()),
              0);
      var board = Blackboard.open(Fixtures.RED, Strategy.RUSH).withPlan(plan, 0);
      var world =
          new WorldSnapshot(
              1,
              MatchPhase.LIVE,
              List.of(self),
              List.of(bomb),
              PoisonView.NONE,
              nav.mapId(),
              List.of());
      var situation =
          new Situation(
              self, world, new Percept(PerceptionState.EMPTY, List.of(), 1), board, Role.RETAKE);
      var thought =
          Tactics.think(TacticsState.fresh(0), situation, context, new SplittableRandom(1));
      assertThat(thought.decision().option()).isEqualTo(Option.DEFUSE);
      assertThat(thought.state().plan().orElseThrow().current())
          .isEqualTo(new PlanStep.Route(slot.pos(), Stance.AGGRESSIVE));
    }
  }

  @Test
  void workersFollowTheTeamFuseObjectiveAndUnassignedBotsChooseTheEarliestFuse() {
    var self = Fixtures.combatant(1, Fixtures.RED, new Vec3(1.5, 1, 1.5));
    var slow =
        new BombView(
            new BombId(1), new BombOwner.Team(Fixtures.RED), Vec3.ZERO, new BombState.Armed(200));
    var urgent =
        new BombView(
            new BombId(2),
            new BombOwner.Team(Fixtures.RED),
            Vec3.ZERO.plus(8, 0, 0),
            new BombState.Armed(40));
    var world =
        new WorldSnapshot(
            1,
            MatchPhase.LIVE,
            List.of(self),
            List.of(slow, urgent),
            PoisonView.NONE,
            "synthetic",
            List.of());
    var percept = new Percept(PerceptionState.EMPTY, List.of(), 1);
    var open = Blackboard.open(Fixtures.RED, Strategy.RUSH);
    assertThat(new Situation(self, world, percept, open, Role.RETAKE).litOwnBomb())
        .contains(urgent);
    var plan =
        new TeamPlan(
            Optional.of(Strategy.RUSH),
            Optional.empty(),
            Optional.of(slow.id()),
            List.of(),
            0,
            List.of(),
            Map.of(),
            0);
    var assigned = open.withPlan(plan, 0);
    assertThat(new Situation(self, world, percept, assigned, Role.RETAKE).litOwnBomb())
        .contains(slow);
  }

  @Test
  void screensYieldTheFuseButRespondImmediatelyWhenTheAssignedWorkerDies() {
    var self = Fixtures.combatant(1, Fixtures.RED, new Vec3(1.5, 1, 1.5));
    var worker = Fixtures.combatant(2, Fixtures.RED, new Vec3(5.5, 1, 5.5));
    var board =
        Blackboard.open(Fixtures.RED, Strategy.RUSH)
            .withRoles(Map.of(self.id(), Role.DEFEND, worker.id(), Role.RETAKE), 0);
    var world =
        new WorldSnapshot(
            1,
            MatchPhase.LIVE,
            List.of(self, worker),
            List.of(),
            PoisonView.NONE,
            "synthetic",
            List.of());
    var percept = new Percept(PerceptionState.EMPTY, List.of(), 1);
    assertThat(Tactics.assignedDefuser(new Situation(self, world, percept, board, Role.DEFEND)))
        .isFalse();
    assertThat(Tactics.assignedDefuser(new Situation(worker, world, percept, board, Role.RETAKE)))
        .isTrue();
    var dead =
        new WorldSnapshot(
            2,
            MatchPhase.LIVE,
            List.of(self, worker.withAlive(false)),
            List.of(),
            PoisonView.NONE,
            "synthetic",
            List.of());
    assertThat(Tactics.assignedDefuser(new Situation(self, dead, percept, board, Role.DEFEND)))
        .isTrue();
  }
}
