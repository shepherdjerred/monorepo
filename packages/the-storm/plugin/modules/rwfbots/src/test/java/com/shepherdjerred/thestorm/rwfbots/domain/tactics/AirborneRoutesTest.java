package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockClassification;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockShape;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.HealthRoutes;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class AirborneRoutesTest {
  private record Course(boolean water, boolean climb, boolean tiered)
      implements BlockClassification {
    @Override
    public GridBounds bounds() {
      return new GridBounds(new BlockPos(0, -1, 0), 9, 12, 3);
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      if (climb && x == 4 && y >= 1 && y <= 5) return BlockShape.FULL;
      if (climb && x == 3 && y >= 1 && y <= 5) return BlockShape.LADDER;
      if (water && x >= 3 && y >= 0 && y <= 1) return BlockShape.LIQUID;
      var floor = tiered && x < 5 ? 4 : 0;
      return y <= floor ? BlockShape.FULL : BlockShape.PASSABLE;
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return shape(x, y, z).blocksMovement();
    }
  }

  private static TacticsContext context(BlockClassification course) {
    var nav = MapBaker.bake("airborne-test", course, new NavSites(List.of(), List.of()));
    return new TacticsContext(
        nav,
        LeverCurves.at(1),
        new Style(0.5, 0.5, 0.5, 0.5),
        Kit.TROOPER,
        Archetype.DUELIST,
        Set.of(),
        196,
        nav.graph().workspace());
  }

  private static CombatantView falling(Vec3 point, double health) {
    return combatant(1, RED, point)
        .withHealth(health, 0)
        .withMotion(false, false)
        .withVel(new Vec3(0, -0.5, 0))
        .withTraversal(TraversalState.UNMODIFIED.withFallDistance(4));
  }

  private static TraversalRisk.Query risk(TacticsContext context, CombatantView self) {
    var graph = context.nav().graph();
    var motion = new NavGraph.EdgeMotion(graph::edgeCost, edge -> true, 1);
    return new TraversalRisk.Query(
        new HealthRoutes.RiskPolicy(self.effectiveHealth() - 1, 0),
        new HealthRoutes.EdgePolicy(graph::edgeDamage, motion),
        node -> 0,
        false,
        new TraversalRisk.Source(self, 10));
  }

  private static List<Waypoint> route(TacticsContext context, CombatantView self, Vec3 goal) {
    var graph = context.nav().graph();
    return RouteNavigator.find(
        context,
        new RouteNavigator.Endpoints(
            graph.nearestNode(self.pos()).orElseThrow(),
            graph.nearestNode(goal).orElseThrow(),
            self.pos(),
            goal),
        new RouteNavigator.Tolls(risk(context, self), node -> 0));
  }

  @Test
  void projectedFirstWalkCannotErasePendingFallDamage() {
    var context = context(new Course(false, false, false));
    var goal = new Vec3(6.5, 1, 1.5);
    var self = falling(new Vec3(1.5, 2.5, 1.5), 3);
    assertThat(route(context, self, goal)).isEmpty();
    var surviving = route(context, self.withHealth(4, 0), goal);
    assertThat(surviving).isNotEmpty();
    assertThat(surviving.getFirst().hop()).isEqualTo(Hop.DROP);
  }

  @Test
  void initialFallIsChargedOnceAndFutureDropStillSpendsRemainingBudget() {
    var context = context(new Course(false, false, true));
    var goal = new Vec3(7.5, 1, 1.5);
    var self = falling(new Vec3(1.5, 6.5, 1.5), 5);
    assertThat(route(context, self, goal)).isNotEmpty();
    assertThat(route(context, self.withHealth(4, 0), goal)).isEmpty();
  }

  @Test
  void reachableAlternativeWaterLandingCanSaveAnOtherwiseLethalPendingFall() {
    var context = context(new Course(true, false, false));
    var self = falling(new Vec3(2.5, 3, 1.5), 3).withVel(new Vec3(0.28, -0.2, 0));
    var path = route(context, self, new Vec3(1.5, 1, 1.5));
    assertThat(path).isNotEmpty();
    assertThat(path.getFirst().landing()).isEqualTo(Waypoint.Landing.WATER);
  }

  @Test
  void waterDestinationDoesNotCancelGroundContactThatHappensFirst() {
    var context = context(new Course(true, false, false));
    var self = falling(new Vec3(2.5, 1.1, 1.5), 2).withVel(new Vec3(0.28, -0.2, 0));
    assertThat(route(context, self, new Vec3(5.5, 1, 1.5))).isEmpty();
  }

  @Test
  void ladderContactCancelsPendingFallBeforeGroundedRoutingResumes() {
    var context = context(new Course(false, true, false));
    var self = falling(new Vec3(2.5, 3, 1.5), 2).withVel(new Vec3(0.28, -0.2, 0));
    var path = route(context, self, new Vec3(1.5, 1, 1.5));
    assertThat(path).isNotEmpty();
    assertThat(path.getFirst().landing()).isEqualTo(Waypoint.Landing.CLIMB);
  }

  @Test
  void alreadyImmersedCancellationPreservesTheActualMidDepthInsteadOfVisitingAPortal() {
    var context = context(new Course(true, false, false));
    var self =
        falling(new Vec3(4.5, 1.25, 1.5), 1)
            .withTraversal(TraversalState.UNMODIFIED.withFallDistance(30));
    var goal = new Vec3(7.5, 1.25, 1.5);
    var expected = route(context, self.withTraversal(TraversalState.UNMODIFIED), goal);
    assertThat(expected).isNotEmpty();
    assertThat(route(context, self, goal)).isEqualTo(expected);
    assertThat(expected).allSatisfy(point -> assertThat(point.pos().y()).isEqualTo(1.25));
  }

  @Test
  void aConfirmedCurrentClimbCancelsDebtWithoutInventingAGroundContact() {
    var context = context(new Course(false, true, false));
    var self =
        falling(new Vec3(3.5, 3, 1.5), 1)
            .withTraversal(TraversalState.UNMODIFIED.withFallDistance(30));
    var goal = new Vec3(3.5, 5, 1.5);
    var expected = route(context, self.withTraversal(TraversalState.UNMODIFIED), goal);
    assertThat(expected).isNotEmpty();
    assertThat(route(context, self, goal)).isEqualTo(expected);
  }

  @Test
  void dryAirBelowTheFirstLadderCannotCancelALethalPendingFall() {
    var context = context(new RaisedLadder());
    var graph = context.nav().graph();
    var dry = graph.nodeAt(new BlockPos(3, 1, 1)).orElseThrow();
    assertThat(graph.climbable(dry)).isFalse();
    assertThat(
            java.util.stream.IntStream.range(graph.edgeStart(dry), graph.edgeEnd(dry))
                .anyMatch(edge -> graph.edgeHop(edge) == Hop.CLIMB))
        .isTrue();
    assertThat(graph.climbable(graph.nodeAt(new BlockPos(3, 2, 1)).orElseThrow())).isTrue();
    var self = falling(new Vec3(3.5, 1.5, 1.5), 1).withVel(new Vec3(0, -0.2, 0));
    assertThat(route(context, self, new Vec3(6.5, 1, 1.5))).isEmpty();
  }

  private record RaisedLadder() implements BlockClassification {
    @Override
    public GridBounds bounds() {
      return new GridBounds(new BlockPos(0, -1, 0), 9, 12, 3);
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      if (y <= 0) return BlockShape.FULL;
      if (x == 4 && y >= 2 && y <= 5) return BlockShape.FULL;
      return x == 3 && y >= 2 && y <= 5 ? BlockShape.LADDER : BlockShape.PASSABLE;
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return shape(x, y, z).blocksMovement();
    }
  }

  @Test
  void unknownOutsideCapsuleCannotBeCertifiedByProjectingOntoAnInsideNode() {
    var context = context(new Course(false, false, false));
    assertThat(route(context, falling(new Vec3(0.1, 2.5, 1.5), 20), new Vec3(6.5, 1, 1.5)))
        .isEmpty();
  }
}
