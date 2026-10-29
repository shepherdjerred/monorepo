package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

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
import org.junit.jupiter.api.Test;

final class PoisonSafetyTest {
  private static final NavArtifact NAV = SyntheticMap.bake();
  private static final Vec3 BOMB = SyntheticMap.RED_BOMB.center();
  private static final Vec3 EXIT = SyntheticMap.BLUE_SPAWN.feet();
  private static final TacticsContext CONTEXT =
      new TacticsContext(
          NAV,
          levers(0.9),
          new Style(0.1, 1, 0.5, 0.2),
          Kit.TROOPER,
          Archetype.TACTICIAN,
          Set.of(),
          5,
          null);

  private static Situation scene(double distance, boolean active) {
    var self = combatant(1, RED, BOMB.plus(distance, -0.5, 0)).withHealth(4, 0);
    var slot =
        new Slot(
            "lane-0",
            SlotKind.LANE,
            Role.ROTATE,
            BOMB.plus(3, -0.5, 0),
            EXIT,
            -1,
            -1,
            Optional.empty(),
            0);
    var plan =
        new TeamPlan(
            Optional.of(Strategy.RUSH),
            Optional.of(SyntheticMap.RED_SPAWN.feet()),
            Optional.empty(),
            List.of(),
            0.5,
            List.of(slot),
            Map.of(self.id(), slot.key()),
            0,
            java.util.Map.of(),
            -1);
    var snapshot =
        new WorldSnapshot(
            100,
            MatchPhase.LIVE,
            List.of(self),
            List.of(
                new BombView(new BombId(0), new BombOwner.Team(RED), BOMB, new BombState.Idle())),
            active ? PoisonView.startedAt(0, 0.1) : PoisonView.NONE,
            NAV.mapId(),
            List.of(),
            List.of(),
            List.of());
    return new Situation(
        self,
        snapshot,
        new Percept(PerceptionState.EMPTY, List.of(), 100),
        Blackboard.open(RED, Strategy.RUSH).withPlan(plan, 0),
        Role.ROTATE);
  }

  @Test
  void lowHealthCannotInterruptEscapeToHealBackInsidePoisonAndTheMarginPreventsOscillation() {
    var escaping =
        Optional.of(Plan.of(Option.ESCAPE_POISON, 0, new PlanStep.Route(EXIT, Stance.CAUTIOUS)));
    for (var picked : List.of(Option.HEAL, Option.HOLD_SLOT, Option.RETREAT)) {
      assertThat(Tactics.choose(picked, Optional.empty(), scene(14, true), Map.of()))
          .isEqualTo(Option.ESCAPE_POISON);
      assertThat(Tactics.choose(picked, escaping, scene(16, true), Map.of()))
          .isEqualTo(Option.ESCAPE_POISON);
      assertThat(Tactics.choose(picked, escaping, scene(20, true), Map.of())).isEqualTo(picked);
      assertThat(Tactics.choose(picked, escaping, scene(14, false), Map.of())).isEqualTo(picked);
    }
  }

  @Test
  void healingFallbackAndStaleSlotsCannotSendTheBotBackIntoTheKnownPoison() {
    var situation = scene(16, true);
    var healing = (PlanStep.Heal) Planner.expand(Option.HEAL, situation, CONTEXT).current();
    assertThat(healing.cover().distance(BOMB)).isGreaterThan(19);
    assertThat(Planner.slotPoint(situation, CONTEXT).orElseThrow().distance(BOMB))
        .isGreaterThan(19);
    var unsafeNode = NAV.graph().nearestNode(SyntheticMap.RED_SPAWN.feet()).orElseThrow();
    assertThat(Planner.coverAvailable(situation, CONTEXT, unsafeNode)).isFalse();
    assertThat(Planner.coverAvailable(scene(16, false), CONTEXT, unsafeNode)).isTrue();
  }
}
