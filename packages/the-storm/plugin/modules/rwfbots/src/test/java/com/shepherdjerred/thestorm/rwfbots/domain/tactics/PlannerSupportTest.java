package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Memory;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Sighting;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Suspicion;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Slot;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotKind;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.team.TeamPlan;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class PlannerSupportTest {
  private static final NavArtifact NAV = SyntheticMap.bake();
  private static final Vec3 SELF = new Vec3(10.5, 1, 10.5);
  private static final Vec3 ENEMY = new Vec3(30.5, 1, 10.5);

  private static Decision fight(Vec3 goal, boolean visible) {
    var self = combatant(1, RED, SELF);
    var enemy = combatant(2, BLUE, ENEMY);
    var slot =
        new Slot("flank-0", SlotKind.FLANK, Role.ROTATE, goal, ENEMY, -1, -1, Optional.empty(), 0);
    var plan =
        new TeamPlan(
            Optional.of(Strategy.SPLIT),
            Optional.of(SELF),
            Optional.empty(),
            List.of(),
            0.5,
            List.of(slot),
            Map.of(self.id(), slot.key()),
            10);
    var board = Blackboard.open(RED, Strategy.SPLIT).withPlan(plan, 10);
    var memory = Memory.EMPTY.remember(enemy.id(), new Sighting(ENEMY, Vec3.ZERO, 10, 1, true));
    var percept =
        new Percept(
            new PerceptionState(memory, Suspicion.NONE), visible ? List.of(enemy) : List.of(), 10);
    var snapshot =
        new WorldSnapshot(
            10,
            MatchPhase.LIVE,
            List.of(self, enemy),
            List.of(),
            PoisonView.NONE,
            NAV.mapId(),
            List.of());
    var situation = new Situation(self, snapshot, percept, board, Role.ROTATE);
    var context =
        new TacticsContext(
            NAV,
            levers(0.8),
            new Style(0.5, 0.5, 0.5, 0.5),
            Kit.LONGBOW,
            Archetype.TACTICIAN,
            Set.of(),
            42);
    return Planner.decide(
        Plan.of(Option.ENGAGE, 10, new PlanStep.Fight(new CombatantId(2))), situation, context, 0);
  }

  @Test
  void aVisibleEnemyDoesNotCancelASafeTeamPosition() {
    var decision = fight(new Vec3(22.5, 1, 25.5), true);
    assertThat(decision.planLabel()).endsWith("-support");
    assertThat(decision.waypoints()).isNotEmpty();
    assertThat(decision.waypoints().getLast().pos()).isEqualTo(new Vec3(22.5, 1, 25.5));
  }

  @Test
  void losingSightDoesNotStrandTheArcherBeforeItsSafePosition() {
    var decision = fight(new Vec3(22.5, 1, 25.5), false);
    assertThat(decision.planLabel()).endsWith("-support");
    assertThat(decision.waypoints()).isNotEmpty();
    assertThat(decision.target()).isEmpty();
  }

  @Test
  void aTeamPositionInsideMeleeRangeDoesNotOverrideTheBowBand() {
    assertThat(fight(new Vec3(29.5, 1, 10.5), true).planLabel()).doesNotEndWith("-support");
  }
}
