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
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Quiver;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/** A bot whose shots spend arrows walks over loose arrows near it when it runs low and is safe. */
final class ResupplyTest {
  private static final NavArtifact NAV = SyntheticMap.bake();
  private static final TacticsContext CROSSBOW =
      new TacticsContext(
          NAV,
          levers(0.5),
          new Style(0.5, 0.5, 0.5, 0.5),
          Kit.TRACKER,
          Archetype.TACTICIAN,
          Set.of(),
          42,
          null);
  private static final long NOW = 200;

  /** West of the wall, on the open floor. */
  private static final Vec3 AT = new Vec3(9.5, 1, 24.5);

  private static final Vec3 NEAR_ARROW = new Vec3(6.3, 1.05, 24.4);
  private static final Vec3 FAR_ARROW = new Vec3(12.6, 1.0, 27.3);
  private static final Quiver LOW = Quiver.of(3);

  private static Situation situation(
      Quiver quiver, List<Vec3> arrows, List<CombatantView> visibleEnemies) {
    var self = combatant(1, RED, AT).withQuiver(quiver);
    var views = new java.util.ArrayList<CombatantView>();
    views.add(self);
    views.addAll(visibleEnemies);
    var snapshot =
        new WorldSnapshot(
            NOW,
            MatchPhase.LIVE,
            views,
            List.of(),
            PoisonView.NONE,
            NAV.mapId(),
            List.of(),
            arrows,
            List.of());
    return new Situation(
        self,
        snapshot,
        new Percept(PerceptionState.EMPTY, visibleEnemies, NOW),
        Blackboard.open(RED, Strategy.TURTLE),
        Role.ROTATE);
  }

  private static Optional<Resupply.Trip> trip(Situation situation) {
    return Resupply.trip(
        situation,
        Features.of(situation, CROSSBOW, Optional.empty(), false),
        CROSSBOW,
        TacticalMemory.EMPTY);
  }

  @Test
  void aLowQuiverHeadsForTheNearestArrowOnAWalkableCell() {
    var situation = situation(LOW, List.of(FAR_ARROW, NEAR_ARROW), List.of());
    var trip = trip(situation).orElseThrow();
    assertThat(trip.pickup().arrow()).isEqualTo(NEAR_ARROW);
    // It stands on the arrow's own cell, where the server's touch picks it up.
    assertThat(trip.pickup().cell().horizontalDistance(NEAR_ARROW)).isLessThan(1);
    assertThat(trip.worth()).isGreaterThan(Utilities.FLOOR);
  }

  @Test
  void anArrowStuckHighInAWallOrOutOfSearchIsLeft() {
    var high = new Vec3(15.9, 3.5, 24.5);
    var distant = AT.plus(Resupply.SEARCH + 2, 0, 0);
    assertThat(trip(situation(LOW, List.of(high, distant), List.of()))).isEmpty();
  }

  @Test
  void aFullerOrEndlessQuiverLeavesArrowsLying() {
    assertThat(trip(situation(Quiver.of(Resupply.RESUPPLY_BELOW), List.of(NEAR_ARROW), List.of())))
        .isEmpty();
    assertThat(trip(situation(Quiver.ENDLESS, List.of(NEAR_ARROW), List.of()))).isEmpty();
  }

  @Test
  void anEmptierQuiverWantsTheArrowMore() {
    var empty = trip(situation(Quiver.of(0), List.of(NEAR_ARROW), List.of())).orElseThrow();
    var half =
        trip(situation(Quiver.of(Resupply.RESUPPLY_BELOW / 2), List.of(NEAR_ARROW), List.of()))
            .orElseThrow();
    assertThat(empty.worth()).isGreaterThan(half.worth());
  }

  @Test
  void aVisibleEnemyNearbyKeepsTheBotOffTheArrows() {
    var enemy = combatant(2, BLUE, AT.plus(-8, 0, -6));
    assertThat(trip(situation(LOW, List.of(NEAR_ARROW), List.of(enemy)))).isEmpty();
    var distant = combatant(2, BLUE, AT.plus(-6, 0, -Resupply.SAFE_RANGE - 4));
    assertThat(trip(situation(LOW, List.of(NEAR_ARROW), List.of(distant)))).isPresent();
  }

  @Test
  void aCellTheBotJustFailedToRouteToIsSkippedForTheNextArrow() {
    var situation = situation(LOW, List.of(FAR_ARROW, NEAR_ARROW), List.of());
    var near = trip(situation).orElseThrow().pickup();
    var memory = TacticalMemory.EMPTY.blocked(near.cell(), NOW);
    var next =
        Resupply.trip(
                situation,
                Features.of(situation, CROSSBOW, Optional.empty(), false),
                CROSSBOW,
                memory)
            .orElseThrow();
    assertThat(next.pickup().arrow()).isEqualTo(FAR_ARROW);
  }

  @Test
  void theTripWalksOntoTheCellAndEndsWhenTheArrowIsGone() {
    var situation = situation(LOW, List.of(NEAR_ARROW), List.of());
    var pickup = trip(situation).orElseThrow().pickup();
    var plan = Resupply.plan(NOW, pickup);
    var decision = Planner.decide(plan, situation, CROSSBOW, 0);
    assertThat(decision.option()).isEqualTo(Option.RESUPPLY);
    assertThat(decision.planLabel()).isEqualTo("resupply:pickup");
    assertThat(decision.waypoints()).isNotEmpty();
    assertThat(decision.waypoints().getLast().pos().horizontalDistance(pickup.cell()))
        .isLessThan(0.5);
    assertThat(Planner.stepDone(plan.current(), situation, NOW)).isFalse();
    var picked = situation(LOW, List.of(), List.of());
    assertThat(Planner.stepDone(plan.current(), picked, NOW)).isTrue();
  }

  @Test
  void aSafeLowCrossbowChoosesToResupply() {
    var situation = situation(Quiver.of(0), List.of(NEAR_ARROW), List.of());
    var thought =
        Tactics.think(TacticsState.fresh(0), situation, CROSSBOW, new SplittableRandom(7));
    assertThat(thought.decision().option()).isEqualTo(Option.RESUPPLY);
    assertThat(thought.decision().planLabel()).isEqualTo("resupply:pickup");
  }
}
