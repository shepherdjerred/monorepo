package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavCodec;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.record.DecisionTrace;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Slot;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotKind;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.team.TeamPlan;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * Spots on shipped maps where live bots stood still for minutes (match recordings of 2026-10-18):
 * shallow water, a slab over air, crops on farmland, a ladder top and open grass. From each of them
 * a bot must keep routing, even when its body still reports the distance of a fall it has landed.
 */
final class StuckSpotsTest {

  record Spot(String map, String where, Vec3 feet) {
    @Override
    public String toString() {
      return map + " " + where;
    }
  }

  static List<Spot> spots() {
    return List.of(
        new Spot("the-harshest-harvest", "shallow water", new Vec3(6168.7, 9.0, 4194.7)),
        new Spot("the-harshest-harvest", "deep water", new Vec3(6167.5, 3.2, 4119.7)),
        new Spot("the-harshest-harvest", "slab over air", new Vec3(6166.0, 13.5, 4196.1)),
        new Spot("the-harshest-harvest", "ladder top", new Vec3(6181.3, 15.0, 4173.4)),
        new Spot("the-harshest-harvest", "grass", new Vec3(6177.7, 10.0, 4134.5)),
        new Spot("miner-dispute", "wheat", new Vec3(4132.6, 51.0, 3161.5)),
        new Spot("miner-dispute", "pumpkin stem", new Vec3(4128.4, 51.9, 3091.6)),
        new Spot("miner-dispute", "shallow water", new Vec3(4130.3, 50.1, 3091.4)));
  }

  private static NavArtifact nav(String map) {
    var path = Path.of(System.getProperty("thestorm.rwfbots.shippedMaps"), map, "nav.rwfnav");
    try {
      return switch (NavCodec.decode(Files.readAllBytes(path))) {
        case Result.Ok<NavArtifact, NavCodec.CodecError>(var nav) -> nav;
        case Result.Err<NavArtifact, NavCodec.CodecError>(var error) ->
            throw new IllegalStateException(map + " nav does not decode: " + error);
      };
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private static TacticsContext context(NavArtifact nav) {
    return new TacticsContext(
        nav,
        levers(1),
        new Style(0.5, 0.5, 0.5, 0.5),
        Kit.TROOPER,
        Archetype.TACTICIAN,
        Set.of(),
        42,
        null);
  }

  private static Situation situation(
      NavArtifact nav, CombatantView self, Optional<Vec3> slotGoal, long tick) {
    var board = Blackboard.open(RED, Strategy.RUSH);
    if (slotGoal.isPresent()) {
      var goal = slotGoal.orElseThrow();
      var slot =
          new Slot("goal", SlotKind.FLANK, Role.ROTATE, goal, goal, -1, -1, Optional.empty(), 0);
      board =
          board.withPlan(
              new TeamPlan(
                  Optional.of(Strategy.RUSH),
                  Optional.of(self.pos()),
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
            tick,
            MatchPhase.LIVE,
            List.of(self, combatant(2, BLUE, self.pos().plus(300, 0, 0))),
            List.of(),
            PoisonView.NONE,
            nav.mapId(),
            List.of());
    return new Situation(
        self, snapshot, new Percept(PerceptionState.EMPTY, List.of(), tick), board, Role.ROTATE);
  }

  /** A grounded body still reporting a long fall it has already landed. */
  private static CombatantView landed(Vec3 feet) {
    var self = combatant(1, RED, feet);
    return self.withTraversal(self.traversal().withFallDistance(30)).withMotion(false, true);
  }

  @ParameterizedTest
  @MethodSource("spots")
  void aLandedBodyRoutesToEverySpawnDespiteAStaleFallDistance(Spot spot) {
    var nav = nav(spot.map());
    var context = context(nav);
    var situation = situation(nav, landed(spot.feet()), Optional.empty(), 100);
    for (var site : nav.sites().spawns()) {
      var node = nav.approachNode(site);
      if (node.isEmpty()) continue;
      var result =
          Planner.pathTo(
              situation,
              context,
              nav.graph().feet(node.getAsInt()),
              new Planner.Way(Stance.CAUTIOUS, false));
      assertThat(result.failure()).as("route to %s", site.name()).isEmpty();
    }
  }

  @ParameterizedTest
  @MethodSource("spots")
  void anUnreachableGoalRecoversWithAStepInsteadOfStanding(Spot spot) {
    var nav = nav(spot.map());
    var context = context(nav);
    var outside = spot.feet().plus(5000, 0, 0);
    var self = landed(spot.feet());
    var situation = situation(nav, self, Optional.of(outside), 100);
    var state =
        new TacticsState(
            Optional.of(
                Plan.of(Option.TAKE_SLOT, 95, new PlanStep.Route(outside, Stance.AGGRESSIVE))),
            95,
            0,
            0,
            RewindClock.UNSTARTED,
            TacticalMemory.EMPTY);

    var thought = Tactics.think(state, situation, context, new SplittableRandom(1));

    assertThat(thought.decision().option()).isEqualTo(Option.RECOVER);
    assertThat(thought.decision().waypoints()).isNotEmpty();
    assertThat(thought.decision().routeFailure()).isEmpty();
    assertThat(thought.trace().movement().routeFailure()).isPresent();
    assertThat(thought.trace().movement().recovery()).isNotEqualTo(DecisionTrace.Recovery.HOLD);
  }

  @ParameterizedTest
  @MethodSource("spots")
  void aBodyKnockedOffTheGraphWalksBackOntoIt(Spot spot) {
    var nav = nav(spot.map());
    var context = context(nav);
    // Three blocks above the recorded spot: no node under the feet, one in reach below.
    var drifted = spot.feet().plus(0, 3, 0);
    var self = combatant(1, RED, drifted).withMotion(false, false);
    var situation = situation(nav, self, Optional.of(spot.feet().plus(5000, 0, 0)), 100);
    var thought =
        Tactics.think(
            new TacticsState(
                Optional.empty(), -1, 0, 0, RewindClock.UNSTARTED, TacticalMemory.EMPTY),
            situation,
            context,
            new SplittableRandom(1));

    assertThat(thought.decision().waypoints())
        .as("recovery %s", thought.trace().movement().recovery())
        .isNotEmpty();
    if (nav.graph().nearestNode(drifted).isEmpty())
      assertThat(thought.trace().movement().recovery()).isEqualTo(DecisionTrace.Recovery.REENTER);
  }

  @Test
  void aRouteBetweenLaddersInAShaftNeverCutsThroughAnEmptyCorner() {
    // cloned-balance: four ladders face into a shaft round an open centre. The baked graph walks
    // diagonally from one ladder to the next through an empty corner, where a body would let go and
    // fall; bodies hung on their ladder trying it.
    var nav = nav("cloned-balance");
    var graph = nav.graph();
    var ladder = graph.nodeAt(new BlockPos(4114, 36, 1099)).orElseThrow();
    var other = graph.nodeAt(new BlockPos(4115, 36, 1100)).orElseThrow();
    var diagonal = -1;
    for (var edge = graph.edgeStart(ladder); edge < graph.edgeEnd(ladder); edge++)
      if (graph.edgeTarget(edge) == other) diagonal = edge;
    assertThat(diagonal).as("the baked diagonal between the ladders").isNotNegative();
    assertThat(graph.unheldClimbDiagonal(diagonal)).isTrue();

    var self = combatant(1, RED, graph.feet(ladder)).withMotion(false, false);
    var situation = situation(nav, self, Optional.empty(), 100);
    var route =
        Planner.pathTo(
            situation, context(nav), graph.feet(other), new Planner.Way(Stance.CAUTIOUS, false));
    var points = route.waypoints();
    for (var i = 0; i + 1 < points.size(); i++) {
      var a = BlockPos.of(points.get(i).pos());
      var b = BlockPos.of(points.get(i + 1).pos());
      assertThat(
              a.x() != b.x()
                  && a.z() != b.z()
                  && a.y() == b.y()
                  && points.get(i + 1).hop() == Hop.WALK)
          .as("level diagonal walk %s -> %s", a, b)
          .isFalse();
    }
    if (!points.isEmpty()) {
      var first = BlockPos.of(points.getFirst().pos());
      assertThat(first).isNotEqualTo(new BlockPos(4115, 36, 1100));
    }
  }

  @Test
  void aBotHangingFromVinesUnderTheIslandLetsGoInsteadOfHangingAllMatch() {
    // hemispheres: vines hang from the island's underside into the void and end under it. Bots
    // knocked off the edge slid down them and hung at the bottom vine for over five minutes.
    var nav = nav("hemispheres");
    var vine = new Vec3(2090.5, 2.7, 3100.5);
    var start = nav.graph().nearestNode(vine).orElseThrow();
    assertThat(nav.graph().climbable(start)).as("the bottom vine").isTrue();
    var spawn = nav.approachNode(nav.sites().spawns().getFirst()).orElseThrow();
    var goal = nav.graph().feet(spawn);
    var self = combatant(1, RED, vine).withMotion(false, false);
    var state =
        new TacticsState(
            Optional.of(Plan.of(Option.TAKE_SLOT, 95, new PlanStep.Route(goal, Stance.CAUTIOUS))),
            95,
            0,
            0,
            RewindClock.UNSTARTED,
            TacticalMemory.EMPTY);

    var thought =
        Tactics.think(
            state,
            situation(nav, self, Optional.of(goal), 100),
            context(nav),
            new SplittableRandom(1));

    assertThat(thought.trace().movement().recovery()).isEqualTo(DecisionTrace.Recovery.LET_GO);
    assertThat(thought.decision().waypoints()).isEmpty();
  }

  @Test
  void aRecoveryStepOffAWalkwayEndIsOneTheBodyCanTakeAndStaysOnTheIsland() {
    // hemispheres: the rim walkway's west end leaves only by leaps, which a body that may not
    // sprint refuses, and by a drop off the rim into the dead ground under the island. A bot there
    // stepped between them for five minutes without moving.
    var nav = nav("hemispheres");
    var graph = nav.graph();
    var spawn = nav.approachNode(nav.sites().spawns().getFirst()).orElseThrow();
    var walking =
        new com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState(
            false, 3, 1, 0, -1, -1, -1, -1, 0, -1, -1, -1, -1, 20, 0);
    var self = combatant(1, RED, new Vec3(2128.9, 42.5, 3094.5)).withTraversal(walking);
    var start = graph.nearestNode(self.pos()).orElseThrow();
    var targets = new java.util.HashSet<Vec3>();
    for (var tick = 100L; tick < 1100; tick += 20) {
      var plan = Planner.recovery(situation(nav, self, Optional.empty(), tick), context(nav));
      assertThat(plan.current()).isInstanceOf(PlanStep.Route.class);
      var goal = ((PlanStep.Route) plan.current()).goal();
      targets.add(goal);
      var node = graph.nearestNode(goal).orElseThrow();
      assertThat(graph.reachable(node, spawn)).as("step to %s keeps the island", goal).isTrue();
      for (var edge = graph.edgeStart(start); edge < graph.edgeEnd(start); edge++)
        if (graph.edgeTarget(edge) == node)
          assertThat(graph.edgeHop(edge)).as("step to %s", goal).isNotEqualTo(Hop.LEAP);
    }
    assertThat(targets).isNotEmpty();
  }

  @ParameterizedTest
  @MethodSource("pools")
  void aBotInAPoolTheGraphHasNoExitFromSwimsToABankItCanClimbOutOnto(Vec3 pool) {
    // cloned-balance: one-block-deep pools the bake gives no way out of. Bots in them circled in
    // RECOVER for minutes; the nearest edge out is a stair's half step above the water, which a
    // swimmer cannot climb, so the escape must swim to a bank at most a block up.
    var nav = nav("cloned-balance");
    var graph = nav.graph();
    var spawn = nav.approachNode(nav.sites().spawns().getFirst()).orElseThrow();
    assertThat(graph.reachable(graph.nearestNode(pool).orElseThrow(), spawn))
        .as("the pool is a sink")
        .isFalse();
    var goal = graph.feet(spawn);
    var state =
        new TacticsState(
            Optional.of(Plan.of(Option.TAKE_SLOT, 95, new PlanStep.Route(goal, Stance.CAUTIOUS))),
            95,
            0,
            0,
            RewindClock.UNSTARTED,
            TacticalMemory.EMPTY);
    var self = combatant(1, RED, pool).withMotion(false, false);
    var thought =
        Tactics.think(
            state,
            situation(nav, self, Optional.of(goal), 100),
            context(nav),
            new SplittableRandom(1));

    assertThat(thought.trace().movement().recovery()).isEqualTo(DecisionTrace.Recovery.ESCAPE);
    var waypoints = thought.decision().waypoints();
    var bank = waypoints.getLast().pos();
    var water =
        waypoints.size() > 1
            ? waypoints.get(waypoints.size() - 2).pos()
            : graph.feet(graph.nearestNode(pool).orElseThrow());
    assertThat(bank.y() - water.y())
        .as("bank rise")
        .isLessThanOrEqualTo(RecoverySteps.BANK_RISE + 1e-6);
    assertThat(graph.reachable(graph.nearestNode(bank).orElseThrow(), spawn)).isTrue();
  }

  static List<Vec3> pools() {
    return List.of(new Vec3(4151.0, 24.0, 1113.0), new Vec3(4142.3, 24.6, 1088.5));
  }

  @Test
  void coverIsNeverInWaterOrAPoolWithNoWayOut() {
    // cloned-balance: slot cover was chosen inside a pool the graph has no exit from, and the
    // bots sent there never got out.
    var nav = nav("cloned-balance");
    var graph = nav.graph();
    var context = context(nav);
    var pool = new Vec3(4150.5, 24.0, 1113.5);
    for (var threat : List.of(pool.plus(20, 0, 0), pool.plus(-20, 0, 0), pool.plus(0, 0, 20))) {
      var self = combatant(1, RED, pool.plus(0, 2, -6)).withMotion(false, true);
      var cover =
          Planner.coverNear(
              situation(nav, self, Optional.empty(), 100),
              context,
              new Planner.CoverSearch(pool, threat, 8));
      cover.ifPresent(
          spot -> {
            assertThat(graph.water().contains(graph.cell(spot.node()))).as("in water").isFalse();
            assertThat(RecoverySteps.sink(context, spot.node())).as("in a sink").isFalse();
          });
    }
  }
}
