package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.HealthRoutes;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementMotor;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.OptionalDouble;
import org.junit.jupiter.api.Test;

final class LeapPreparationTest {
  private static NavGraph graph() {
    var bounds = new GridBounds(new BlockPos(0, 0, 0), 9, 3, 5);
    return new NavGraph(
        bounds,
        new int[] {
          bounds.index(2, 1, 1), bounds.index(4, 1, 1), bounds.index(6, 1, 1), bounds.index(6, 1, 4)
        },
        new NavGraph.Topology(new int[] {0, 2, 3, 4, 4}, new int[] {1, 2, 2, 3}),
        new NavGraph.EdgeData(
            new byte[] {Hop.WALK.code(), Hop.LEAP.code(), Hop.WALK.code(), Hop.LEAP.code()},
            new float[] {8, 12, 8, 12}));
  }

  @Test
  void firstEntryJudgesTheBodyWhereThePlanWillReachIt() {
    var graph = graph();
    var launch = graph.waypoint(1).launch().orElseThrow();
    var lead = MovementMotor.SPRINT_SPEED * LeapPreparation.PLAN_LATENCY_TICKS;
    // Sprinting at the takeoff the plan arrives on time; a plan made at the takeoff arrives late.
    var ready = combatant(1, RED, launch.takeoff().plus(-lead, 0, 0)).withVel(new Vec3(0.28, 0, 0));
    assertThat(LeapPreparation.ticks(graph, 1, ready, 0)).isZero();
    var overshooting = ready.withPos(launch.takeoff());
    assertThat(LeapPreparation.ticks(graph, 1, overshooting, 0)).isGreaterThan(14);
    var stopped = ready.withPos(launch.takeoff()).withVel(Vec3.ZERO);
    assertThat(LeapPreparation.ticks(graph, 1, stopped, 0)).isGreaterThan(14);
    var displaced = stopped.withPos(stopped.pos().plus(0, 0, 1));
    assertThat(LeapPreparation.ticks(graph, 1, displaced, 0))
        .isGreaterThan(LeapPreparation.ticks(graph, 1, stopped, 0));
  }

  @Test
  void futureTurnCannotBorrowCurrentAlignedMomentumEvenAtItsTakeoff() {
    var graph = graph();
    var launch = graph.waypoint(3).launch().orElseThrow();
    // Momentum along the leap's heading but off its line still needs a turn and a full run-up.
    var offLine = combatant(1, RED, graph.feet(0)).withVel(new Vec3(0, 0, 0.28));
    assertThat(LeapPreparation.ticks(graph, 3, offLine, 0)).isGreaterThan(20);
    var lead = MovementMotor.SPRINT_SPEED * LeapPreparation.PLAN_LATENCY_TICKS;
    var currentlyAligned =
        combatant(1, RED, launch.takeoff().plus(0, 0, -lead)).withVel(new Vec3(0, 0, 0.28));
    assertThat(LeapPreparation.ticks(graph, 3, currentlyAligned, 2)).isZero();
  }

  @Test
  void aFutureLeapCostsNoSetupForABodyAlreadyRunningUpItsLine() {
    var graph = graph();
    var launch = graph.waypoint(3).launch().orElseThrow();
    var running =
        combatant(1, RED, launch.runUpStart().plus(0, 0, -2)).withVel(new Vec3(0, 0, 0.28));
    assertThat(LeapPreparation.ticks(graph, 3, running, 0)).isZero();
    // Standing on the line, or too far back for the line to predict the route, is not running in.
    assertThat(LeapPreparation.ticks(graph, 3, running.withVel(Vec3.ZERO), 0)).isGreaterThan(20);
    var distant =
        running.withPos(launch.runUpStart().plus(0, 0, -LeapPreparation.RUNNING_REACH - 2));
    assertThat(LeapPreparation.ticks(graph, 3, distant, 0)).isGreaterThan(20);
  }

  @Test
  void cachedFuturePreparationRetainsTheExactOriginalGeometricCalculation() {
    var graph = graph();
    var self = combatant(1, RED, graph.feet(0));
    for (var edge : new int[] {1, 3}) {
      var launch = graph.waypoint(edge).launch().orElseThrow();
      var runUp = launch.takeoff().horizontalDistance(launch.runUpStart());
      var expected = Double.doubleToRawLongBits(2 * runUp / MovementMotor.SPRINT_SPEED + 6);
      for (var attempt = 0; attempt < 3; attempt++)
        assertThat(Double.doubleToRawLongBits(LeapPreparation.ticks(graph, edge, self, -1)))
            .isEqualTo(expected);
    }
  }

  @Test
  void setupMakesWalkingPreferableAndPreventsAnOptimisticJumpDeadline() {
    var graph = graph();
    var self = combatant(1, RED, graph.feet(0));
    var motion =
        new NavGraph.EdgeMotion(
            edge ->
                graph.edgeCost(edge)
                    + (graph.edgeHop(edge) == Hop.LEAP
                        ? LeapPreparation.ticks(graph, edge, self, 0)
                        : 0),
            edge -> true,
            1);
    var risk = new HealthRoutes.RiskPolicy(19, 0, OptionalDouble.of(18));
    var found =
        HealthRoutes.find(
            graph,
            new HealthRoutes.Request(0, 2, risk, node -> 0),
            new HealthRoutes.EdgePolicy(edge -> 0, motion),
            null);
    assertThat(found.orElseThrow().path().nodes()).containsExactly(0, 1, 2);
    var turnDeadline = new HealthRoutes.RiskPolicy(19, 0, OptionalDouble.of(30));
    assertThat(
            HealthRoutes.find(
                graph,
                new HealthRoutes.Request(0, 3, turnDeadline, node -> 0),
                new HealthRoutes.EdgePolicy(edge -> 0, motion),
                null))
        .isEmpty();
  }
}
