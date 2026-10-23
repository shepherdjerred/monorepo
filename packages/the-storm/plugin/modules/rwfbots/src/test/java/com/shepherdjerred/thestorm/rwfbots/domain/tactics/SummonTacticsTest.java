package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Grudge;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Memory;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Suspicion;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
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
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.SummonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/** Bots get out of a golem's way, answer a dog, and never blame a summon's owner for its blow. */
final class SummonTacticsTest {
  private static final NavArtifact NAV = SyntheticMap.bake();
  private static final long NOW = 200;
  private static final Vec3 HOME = new Vec3(6.5, 1, 6.5);

  private static SummonView summon(SummonView.Kind kind, TeamId team, Vec3 pos) {
    return new SummonView(new CombatantId(5), kind, team, pos, Vec3.ZERO, 30);
  }

  private record Scene(
      CombatantView self,
      List<CombatantView> seen,
      List<SummonView> summons,
      Optional<Grudge> grudge,
      List<BombView> bombs) {

    Situation situation(Role role, boolean slotted) {
      var bodies = new java.util.ArrayList<CombatantView>();
      bodies.add(self);
      bodies.add(combatant(9, RED, new Vec3(14.5, 1, 28.5)));
      bodies.addAll(seen);
      var board = Blackboard.open(RED, Strategy.RUSH);
      if (slotted) {
        var slot =
            new Slot(
                "anchor-0",
                SlotKind.ANCHOR,
                Role.DEFEND,
                self.pos(),
                self.pos().plus(0, 0, 10),
                -1,
                -1,
                Optional.empty(),
                0);
        board =
            board.withPlan(
                new TeamPlan(
                    Optional.of(Strategy.RUSH),
                    Optional.empty(),
                    Optional.empty(),
                    List.of(),
                    0.5,
                    List.of(slot),
                    Map.of(self.id(), slot.key()),
                    0,
                    Map.of()),
                0);
      }
      var snapshot =
          new WorldSnapshot(
              NOW,
              MatchPhase.LIVE,
              bodies,
              bombs,
              PoisonView.NONE,
              NAV.mapId(),
              List.of(),
              List.of(),
              summons);
      var percept =
          new Percept(
              new PerceptionState(Memory.EMPTY, Suspicion.NONE, -1, grudge),
              seen,
              NOW,
              summons.stream().filter(summon -> summon.hostileTo(RED)).toList());
      return new Situation(self, snapshot, percept, board, role);
    }
  }

  private static Thought think(Situation situation) {
    return Tactics.think(
        TacticsState.fresh(0),
        situation,
        new TacticsContext(
            NAV,
            levers(1),
            new Style(0.5, 0.5, 0.5, 0.5),
            Kit.TROOPER,
            Archetype.TACTICIAN,
            Set.of(),
            7,
            null),
        new SplittableRandom(3));
  }

  @Test
  void aHolderNextToAnEnemyGolemGetsOutOfItsWay() {
    var self = combatant(1, RED, HOME);
    var golem = summon(SummonView.Kind.GOLEM, BLUE, HOME.plus(3, 0, 0));
    var thought =
        think(
            new Scene(self, List.of(), List.of(golem), Optional.empty(), List.of())
                .situation(Role.DEFEND, true));
    assertThat(thought.trace().choice()).isEqualTo(Option.RETREAT);
    var flee = thought.state().plan().orElseThrow().current();
    assertThat(flee).isInstanceOf(PlanStep.Flee.class);
    var goal = ((PlanStep.Flee) flee).goal();
    assertThat(goal.distance(golem.pos())).isGreaterThan(self.pos().distance(golem.pos()));

    var ours = summon(SummonView.Kind.GOLEM, RED, HOME.plus(3, 0, 0));
    var calm =
        think(
            new Scene(self, List.of(), List.of(ours), Optional.empty(), List.of())
                .situation(Role.DEFEND, true));
    assertThat(calm.trace().choice()).isNotEqualTo(Option.RETREAT);
  }

  @Test
  void aDefuserLeavesTheFuseOnlyForASummonUponIt() {
    var site = NAV.sites().bombs().getFirst();
    var bomb =
        new BombView(
            new BombId(1), new BombOwner.Team(RED), site.cell().center(), new BombState.Armed(400));
    var self = combatant(1, RED, Planner.approach(NAV, bomb));
    var choices = new java.util.EnumMap<SummonView.Kind, Option>(SummonView.Kind.class);
    for (var kind : SummonView.Kind.values()) {
      var upon = summon(kind, BLUE, self.pos().plus(2, 0, 0));
      choices.put(
          kind,
          think(
                  new Scene(self, List.of(), List.of(upon), Optional.empty(), List.of(bomb))
                      .situation(Role.RETAKE, false))
              .trace()
              .choice());
    }
    assertThat(choices)
        .containsEntry(SummonView.Kind.GOLEM, Option.RETREAT)
        .containsEntry(SummonView.Kind.WOLF, Option.ENGAGE);
    var away = summon(SummonView.Kind.WOLF, BLUE, self.pos().plus(8, 0, 0));
    assertThat(
            think(
                    new Scene(self, List.of(), List.of(away), Optional.empty(), List.of(bomb))
                        .situation(Role.RETAKE, false))
                .trace()
                .choice())
        .isEqualTo(Option.DEFUSE);
  }

  @Test
  void aGolemsBlowDrawsNoAggroOntoItsOwner() {
    var self = combatant(1, RED, HOME);
    var owner = combatant(2, BLUE, HOME.plus(12, 0, 0));
    var golem = summon(SummonView.Kind.GOLEM, BLUE, HOME.plus(-2, 0, 10));
    var situation =
        new Scene(
                self,
                List.of(owner),
                List.of(golem),
                Optional.of(new Grudge(golem.id(), NOW - 5, HOME)),
                List.of())
            .situation(Role.DEFEND, true);
    assertThat(Aggro.pull(situation)).isEmpty();
    assertThat(think(situation).trace().features())
        .doesNotContain(
            new com.shepherdjerred.thestorm.rwfbots.domain.record.DecisionTrace.Feature(
                "aggro", 1));
  }
}
