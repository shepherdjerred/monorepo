package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
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
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** Holding a slot is a patrol between nearby posts, and stands still only to shoot. */
final class PatrolTest {
  private static final Vec3 SLOT = new Vec3(5.5, 1, 5.5);
  private static final TacticsContext CONTEXT =
      new TacticsContext(
          SyntheticMap.bake(),
          levers(1),
          new Style(0.5, 0.5, 0.5, 0.5),
          Kit.TROOPER,
          Archetype.TACTICIAN,
          Set.of(),
          42,
          null);

  private static Situation situation(long tick, List<CombatantView> visible) {
    var self = combatant(1, RED, SLOT);
    var slot =
        new Slot(
            "hold",
            SlotKind.FLANK,
            Role.DEFEND,
            SLOT,
            SLOT.plus(10, 0, 0),
            -1,
            -1,
            Optional.empty(),
            0);
    var board =
        Blackboard.open(RED, Strategy.RUSH)
            .withPlan(
                new TeamPlan(
                    Optional.of(Strategy.RUSH),
                    Optional.of(SLOT),
                    Optional.empty(),
                    List.of(),
                    0.5,
                    List.of(slot),
                    Map.of(self.id(), slot.key()),
                    0,
                    Map.of()),
                0);
    var enemy = combatant(2, BLUE, SLOT.plus(12, 0, 0));
    var snapshot =
        new WorldSnapshot(
            tick,
            MatchPhase.LIVE,
            List.of(self, combatant(3, RED, SLOT.plus(-20, 0, 0)), enemy),
            List.of(),
            PoisonView.NONE,
            CONTEXT.nav().mapId(),
            List.of());
    return new Situation(
        self, snapshot, new Percept(PerceptionState.EMPTY, visible, tick), board, Role.DEFEND);
  }

  private static Plan hold() {
    return Plan.of(
        Option.HOLD_SLOT, 0, new PlanStep.Hold(SLOT, SLOT.plus(10, 0, 0), Stance.CAUTIOUS));
  }

  @Test
  void aSlotHolderWithNothingInSightMovesBetweenPostsInsideItsSlot() {
    var posts = new HashSet<Vec3>();
    var moving = 0;
    for (var tick = 0L; tick < 2000; tick += 20) {
      var decision = Planner.decide(hold(), situation(tick, List.of()), CONTEXT, 0);
      assertThat(decision.routeFailure()).isEmpty();
      if (decision.waypoints().isEmpty()) continue;
      moving++;
      var post = decision.waypoints().getLast().pos();
      assertThat(post.horizontalDistance(SLOT)).isLessThanOrEqualTo(Patrol.SLOT_RADIUS);
      posts.add(post);
    }
    assertThat(posts).as("distinct posts visited").hasSizeGreaterThanOrEqualTo(4);
    assertThat(moving).as("decisions that walk to a post").isGreaterThan(50);
  }

  @Test
  void aSlotHolderWithAnEnemyInSightStandsAndWatches() {
    var enemy = combatant(2, BLUE, SLOT.plus(12, 0, 0));
    for (var tick = 0L; tick < 600; tick += 20) {
      var decision = Planner.decide(hold(), situation(tick, List.of(enemy)), CONTEXT, 0);
      assertThat(decision.waypoints()).isEmpty();
    }
  }
}
