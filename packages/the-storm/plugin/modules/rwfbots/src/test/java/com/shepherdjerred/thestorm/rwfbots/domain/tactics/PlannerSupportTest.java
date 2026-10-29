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
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
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

  private record BoundScene(Situation situation, TacticsContext context) {}

  private static BoundScene openBound(double enemyX, long tick) {
    var self = combatant(1, RED, new Vec3(12.5, 1, 12.5));
    var enemy = combatant(2, BLUE, new Vec3(enemyX, 1, 12.5));
    var slot =
        new Slot(
            "flank-0",
            SlotKind.FLANK,
            Role.ROTATE,
            new Vec3(12.5, 1, 26.5),
            enemy.pos(),
            -1,
            -1,
            Optional.empty(),
            0);
    var plan =
        new TeamPlan(
            Optional.of(Strategy.SPLIT),
            Optional.of(new Vec3(2.5, 1, 2.5)),
            Optional.empty(),
            List.of(),
            0.5,
            List.of(slot),
            Map.of(self.id(), slot.key()),
            tick,
            java.util.Map.of(),
            -1);
    var board = Blackboard.open(RED, Strategy.SPLIT).withPlan(plan, tick);
    var snapshot =
        new WorldSnapshot(
            tick,
            MatchPhase.LIVE,
            List.of(self, enemy),
            List.of(),
            PoisonView.NONE,
            NAV.mapId(),
            List.of(),
            List.of(),
            List.of());
    var situation =
        new Situation(
            self,
            snapshot,
            new Percept(PerceptionState.EMPTY, List.of(enemy), tick),
            board,
            Role.ROTATE);
    var context =
        new TacticsContext(
            NAV,
            levers(0.8),
            new Style(0.5, 0.5, 0.5, 0.5),
            Kit.TROOPER,
            Archetype.TACTICIAN,
            Set.of(),
            42,
            null);
    return new BoundScene(situation, context);
  }

  private static Planner.CoverSpot nearestSafetyCover(BoundScene scene) {
    var situation = scene.situation();
    return Planner.coverNear(
            situation,
            scene.context(),
            new Planner.CoverSearch(
                situation.self().pos(),
                situation.nearestEnemy().orElseThrow().pos(),
                Planner.BOUND_REACH))
        .orElseThrow();
  }

  @Test
  void sharingACoverCellStillRoutesTheBodyToItsCenter() {
    var scene = openBound(30.5, 10);
    var original = scene.situation();
    var self = original.self().withPos(new Vec3(12.01, 1, 12.01));
    var situation =
        new Situation(
            self, original.snapshot(), original.percept(), original.board(), original.role());
    var goal = new Vec3(12.5, 1, 12.5);
    assertThat(self.pos().horizontalDistance(goal)).isGreaterThan(Planner.COVER_REACHED);
    assertThat(NAV.graph().nearestNode(self.pos())).isEqualTo(NAV.graph().nearestNode(goal));
    var route =
        Planner.pathTo(situation, scene.context(), goal, new Planner.Way(Stance.AGGRESSIVE, false));
    assertThat(route)
        .isInstanceOf(com.shepherdjerred.thestorm.rwfbots.domain.map.RouteResult.Path.class);
    assertThat(route.waypoints()).hasSize(1);
    assertThat(route.waypoints().getFirst().pos()).isEqualTo(goal);
  }

  @Test
  void formationHoldsDoNotStopABlockShortOfTheirAssignedSpacing() {
    var scene = openBound(30.5, 10);
    var original = scene.situation();
    var goal = original.slot().orElseThrow().pos();
    var self = original.self().withPos(goal.plus(-1, 0, 0));
    var situation =
        new Situation(
            self, original.snapshot(), original.percept(), original.board(), original.role());
    var plan =
        Plan.of(
            Option.HOLD_SLOT,
            10,
            new PlanStep.Hold(goal, new Vec3(30.5, 1, 12.5), Stance.CAUTIOUS));
    var decision = Planner.decide(plan, situation, scene.context(), 0);
    assertThat(decision.waypoints()).isNotEmpty();
    assertThat(decision.waypoints().getLast().pos()).isEqualTo(goal);
  }

  @Test
  void aMovingBoundPrefersForwardCoverOverNearerSidewaysSafety() {
    for (var scene : List.of(openBound(30.5, 10), openBound(24.5, 40))) {
      var situation = scene.situation();
      var self = situation.self().pos();
      var goal = situation.slot().orElseThrow().pos();
      var threat = situation.nearestEnemy().orElseThrow().pos();
      var forward = new Vec3(15.5, 1, 19.5);
      var forwardNode = NAV.graph().nearestNode(forward).orElseThrow();
      assertThat(NAV.graph().feet(forwardNode)).isEqualTo(forward);
      assertThat(
              NAV.cover()
                  .protectingFrom(
                      NAV.graph(),
                      self.plus(0, 0, Planner.BOUND_STEP),
                      threat,
                      Planner.BOUND_SEARCH))
          .extracting(point -> point.node())
          .contains(forwardNode);
      assertThat(forward.horizontalDistance(goal)).isLessThan(self.horizontalDistance(goal));
      var nearby = nearestSafetyCover(scene);
      assertThat(nearby.pos().horizontalDistance(goal))
          .isGreaterThanOrEqualTo(self.horizontalDistance(goal));
      var plan = Planner.expand(Option.TAKE_SLOT, situation, scene.context());
      assertThat(plan.current()).isInstanceOf(PlanStep.Cover.class);
      var chosen = (PlanStep.Cover) plan.current();
      assertThat(chosen.pos().horizontalDistance(goal)).isLessThan(self.horizontalDistance(goal));
    }
  }

  @Test
  void distantSightingsDoNotCreateExtraIdleTimeAtEachSafeCoverBound() {
    for (var enemyX : List.of(30.5, 24.5)) {
      var scene = openBound(enemyX, 40);
      var original = scene.situation();
      var plan = Planner.expand(Option.TAKE_SLOT, original, scene.context());
      var cover = (PlanStep.Cover) plan.current();
      var arrived =
          new Situation(
              original.self().withPos(cover.pos()),
              original.snapshot(),
              original.percept(),
              original.board(),
              original.role());
      assertThat(Planner.stepDone(cover, arrived, plan.startedTick()))
          .as("distant sightings permit continuing; close fire retains the settling pause")
          .isEqualTo(enemyX == 30.5);
    }
  }

  @Test
  void aPinnedHolderStillTakesTheNearestSafetyCover() {
    var scene = openBound(24.5, 80);
    assertThat(Planner.mover(scene.situation(), 2)).isFalse();
    var plan = Planner.expand(Option.TAKE_SLOT, scene.situation(), scene.context());
    assertThat(plan.current()).isInstanceOf(PlanStep.Cover.class);
    assertThat(((PlanStep.Cover) plan.current()).pos()).isEqualTo(nearestSafetyCover(scene).pos());
  }

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
            10,
            Map.of(),
            -1);
    var board = Blackboard.open(RED, Strategy.SPLIT).withPlan(plan, 10);
    var memory =
        Memory.EMPTY.remember(enemy.id(), new Sighting(ENEMY, Vec3.ZERO, 10, 1, true, true));
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
            List.of(),
            List.of(),
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
            42,
            null);
    return Planner.decide(
        Plan.of(Option.ENGAGE, 10, new PlanStep.Fight(new CombatantId(2))), situation, context, 0);
  }

  @Test
  void aVisibleEnemyDoesNotCancelASafeTeamPosition() {
    var decision = fight(new Vec3(22.5, 1, 25.5), true);
    assertThat(decision.planLabel()).endsWith("-support");
    assertThat(decision.waypoints()).isNotEmpty();
    assertThat(decision.waypoints().getLast().pos()).isEqualTo(new Vec3(22.5, 1, 25.5));
    // It draws on the enemy it can see while it walks, rather than only once it stops.
    assertThat(decision.target()).contains(new CombatantId(2));
  }

  private static TacticsContext archer(TacticsContext sword) {
    return new TacticsContext(
        NAV,
        sword.levers(),
        sword.style(),
        Kit.LONGBOW,
        sword.archetype(),
        sword.quirks(),
        sword.seed(),
        null);
  }

  @Test
  void aBowTakesItsWholeBandHoldingButOnlyItsNearEdgeOnTheMoveAndNothingOnADash() {
    // 18 blocks: inside the longbow's band, beyond its near edge.
    var far = openBound(30.5, 10);
    var archer = archer(far.context());
    assertThat(archer.keep().min()).isLessThan(18);
    assertThat(archer.keep().max()).isGreaterThan(18);
    assertThat(Pace.STILL.target(far.situation(), archer)).contains(new CombatantId(2));
    assertThat(Pace.MOVING.target(far.situation(), archer)).isEmpty();
    // 12 blocks: inside the near edge, so it draws as it walks, but not while dashing for cover.
    var near = openBound(24.5, 10);
    assertThat(Pace.MOVING.target(near.situation(), archer)).contains(new CombatantId(2));
    assertThat(Pace.DASHING.target(near.situation(), archer)).isEmpty();
    // A sword only answers an enemy it can swing at.
    assertThat(Pace.STILL.target(near.situation(), near.context())).isEmpty();
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
