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
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * Fall damage on routes, from the shipped maps where bots lost the most health to falls outside any
 * fight: beanstalk's irrigation holes and its tall drops, and cors-path's spawn ledges.
 */
final class FallDamageRoutesTest {

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

  private static Situation situation(NavArtifact nav, CombatantView self) {
    var snapshot =
        new WorldSnapshot(
            100,
            MatchPhase.LIVE,
            List.of(self, combatant(2, BLUE, self.pos().plus(300, 0, 0))),
            List.of(),
            PoisonView.NONE,
            nav.mapId(),
            List.of(),
            List.of(),
            List.of());
    return new Situation(
        self,
        snapshot,
        new Percept(PerceptionState.EMPTY, List.of(), 100),
        Blackboard.open(RED, Strategy.RUSH),
        Role.ROTATE);
  }

  private static CombatantView standing(Vec3 feet) {
    return combatant(1, RED, feet).withMotion(false, true);
  }

  /** The fall damage the bot in {@code situation} expects along {@code points}, edge by edge. */
  private static int damage(NavArtifact nav, Situation situation, List<Waypoint> points) {
    var graph = nav.graph();
    var at = graph.nearestNode(situation.self().pos()).orElseThrow();
    var total = 0;
    for (var point : points) {
      var next = graph.nearestNode(point.pos());
      if (next.isEmpty()) continue;
      for (var edge = graph.edgeStart(at); edge < graph.edgeEnd(at); edge++)
        if (graph.edgeTarget(edge) == next.getAsInt() && graph.edgeHop(edge) == point.hop())
          total += FallRisk.damage(graph, edge, situation.self().traversal(), situation.now());
      at = next.getAsInt();
    }
    return total;
  }

  @Test
  void aOneBlockIrrigationHoleDoesNotBreakAFall() {
    // beanstalk: a drop of 22 blocks into a single water block among farmland was certified as a
    // water landing, but the farmland rim stands above the water's surface, and the bodies that
    // took it landed on the rim and lost 19 of 20 health.
    var nav = nav("beanstalk");
    var graph = nav.graph();
    var hole = new BlockPos(3121, 3, 1062);
    assertThat(graph.water().contains(hole)).isTrue();
    assertThat(graph.cushions(hole)).isFalse();
    var top = graph.nodeAt(new BlockPos(3120, 26, 1063)).orElseThrow();
    var into = graph.nodeAt(hole).orElseThrow();
    var self = standing(graph.feet(top));
    var drops = 0;
    for (var edge = graph.edgeStart(top); edge < graph.edgeEnd(top); edge++) {
      if (graph.edgeTarget(edge) != into) continue;
      drops++;
      assertThat(graph.edgeHop(edge)).isEqualTo(Hop.DROP);
      assertThat(graph.edgeDamage(edge)).as("baked").isGreaterThan(15);
      assertThat(FallRisk.damage(graph, edge, self.traversal(), 100)).isGreaterThan(15);
      assertThat(graph.waypoint(edge).landing()).isEqualTo(Waypoint.Landing.GROUND);
    }
    assertThat(drops).as("the baked drop into the hole").isEqualTo(1);
  }

  @Test
  void aBotTakesTheStairsInsteadOfATallDrop() {
    // beanstalk: from the leaves above the irrigated field the way down the stalk costs no health.
    var nav = nav("beanstalk");
    var start = new Vec3(3119.9, 26.2, 1063.8);
    var situation = situation(nav, standing(start));
    for (var stance : List.of(Stance.CAUTIOUS, Stance.AGGRESSIVE)) {
      var route =
          Planner.pathTo(
              situation,
              context(nav),
              new Vec3(3121.7, 3.9, 1062.3),
              new Planner.Way(stance, false));
      assertThat(route.failure()).isEmpty();
      assertThat(damage(nav, situation, route.waypoints()))
          .as("%s fall damage", stance)
          .isLessThanOrEqualTo(RouteNavigator.GENTLE_FALLS);
    }
  }

  @Test
  void aBotLeavesItsSpawnLedgeByItsGentlestDrop() {
    // cors-path: every route off a spawn ledge drops at least 4 health's worth; bots took the
    // 7-damage drop beside it to save two seconds.
    var nav = nav("cors-path");
    var context = context(nav);
    for (var spawn : nav.sites().spawns()) {
      if (!spawn.name().endsWith("-1")) continue;
      var feet = nav.graph().feet(nav.approachNode(spawn).orElseThrow());
      var situation = situation(nav, standing(feet));
      for (var bomb : nav.sites().bombs()) {
        var goal = nav.graph().feet(nav.approachNode(bomb).orElseThrow());
        var route =
            Planner.pathTo(situation, context, goal, new Planner.Way(Stance.AGGRESSIVE, false));
        assertThat(route.failure()).as("%s to %s", spawn.name(), bomb.name()).isEmpty();
        assertThat(damage(nav, situation, route.waypoints()))
            .as("%s to %s fall damage", spawn.name(), bomb.name())
            .isLessThanOrEqualTo(RouteNavigator.GENTLE_FALLS);
      }
    }
  }

  @Test
  void aBotNeverPlansAFallItWouldNotSurvive() {
    // A cors-path spawn ledge is left only by a drop worth 4 health: a bot with less than that
    // left is given no route off it at all.
    var nav = nav("cors-path");
    var spawn = nav.sites().spawns().getFirst();
    var feet = nav.graph().feet(nav.approachNode(spawn).orElseThrow());
    var bomb = nav.graph().feet(nav.approachNode(nav.sites().bombs().getLast()).orElseThrow());
    for (var health : List.of(3.0, 4.0, 5.0, 8.0)) {
      var self = standing(feet).withHealth(health, 0);
      var situation = situation(nav, self);
      var route =
          Planner.pathTo(situation, context(nav), bomb, new Planner.Way(Stance.AGGRESSIVE, false));
      assertThat(damage(nav, situation, route.waypoints()))
          .as("fall damage at %s health", health)
          .isLessThan((int) Math.ceil(health));
    }
  }
}
