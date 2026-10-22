package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockClassification;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockShape;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
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
    return situation(tick, visible, CONTEXT);
  }

  private static Situation situation(
      long tick, List<CombatantView> visible, TacticsContext context) {
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
            context.nav().mapId(),
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
  void eachMoveBetweenPostsIsAWalkToAnotherPost() {
    // hemispheres: holders patrolling within 1.8 blocks of their slot looked like they stood still.
    var previous = Optional.<Vec3>empty();
    var moves = 0;
    for (var tick = 0L; tick < 4000; tick += 5) {
      var post = Patrol.post(situation(tick, List.of()), CONTEXT, SLOT, Patrol.SLOT_RADIUS);
      assertThat(post).isPresent();
      if (previous.isPresent() && !previous.orElseThrow().equals(post.orElseThrow())) {
        moves++;
        assertThat(post.orElseThrow().horizontalDistance(previous.orElseThrow()))
            .as("distance between consecutive posts")
            .isGreaterThanOrEqualTo(2.0);
      }
      previous = post;
    }
    assertThat(moves).isGreaterThan(40);
  }

  /** Open floor with a shallow pond from x = 7 east, beside the slot. */
  private record PondField() implements BlockClassification {
    @Override
    public GridBounds bounds() {
      return new GridBounds(new BlockPos(0, 0, 0), 12, 4, 12);
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      if (y == 0) return BlockShape.FULL;
      return y == 1 && x >= 7 ? BlockShape.LIQUID : BlockShape.PASSABLE;
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return shape(x, y, z).blocksMovement();
    }
  }

  @Test
  void aPatrolNeverWadesIntoWaterBesideItsSlot() {
    // hemispheres: a holder whose patrol or slot lay in a pond trod water there all match.
    var nav = MapBaker.bake("pond-field", new PondField(), new NavSites(List.of(), List.of()));
    var graph = nav.graph();
    assertThat(graph.nodeAt(new BlockPos(7, 1, 5)))
        .as("a swimmable pond node in range")
        .isPresent();
    var context =
        new TacticsContext(
            nav,
            levers(1),
            new Style(0.5, 0.5, 0.5, 0.5),
            Kit.TROOPER,
            Archetype.TACTICIAN,
            Set.of(),
            42,
            null);
    var posts = new HashSet<Vec3>();
    for (var tick = 0L; tick < 6000; tick += 10) {
      Patrol.post(situation(tick, List.of(), context), context, SLOT, Patrol.SLOT_RADIUS)
          .ifPresent(posts::add);
    }
    assertThat(posts).hasSizeGreaterThanOrEqualTo(4);
    assertThat(posts).allSatisfy(post -> assertThat(post.x()).isLessThan(7));
  }

  @Test
  void aSlotHolderWithAnEnemyInSightStandsAndWatches() {
    var enemy = combatant(2, BLUE, SLOT.plus(12, 0, 0));
    for (var tick = 0L; tick < 600; tick += 20) {
      var decision = Planner.decide(hold(), situation(tick, List.of(enemy)), CONTEXT, 0);
      assertThat(decision.waypoints()).isEmpty();
    }
  }

  @Test
  void aPatrolUsesEveryPostEachRoundWithoutRepeatingOne() {
    for (var size = 1; size <= 9; size++) {
      for (var bot = 0; bot < 5; bot++) {
        var seen = new java.util.HashSet<Integer>();
        var last = -1;
        for (var visit = 0L; visit < size * 3L; visit++) {
          var post = Patrol.across(bot, visit, size);
          if (visit < size) seen.add(post);
          if (size > 1) assertThat(post).as("size %d visit %d", size, visit).isNotEqualTo(last);
          last = post;
        }
        assertThat(seen).as("size %d", size).hasSize(size);
      }
    }
  }
}
