package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import org.junit.jupiter.api.Test;

final class BowSolverTest {

  /**
   * Flies an arrow from {@code from} along {@code facing} and returns its closest pass to target.
   */
  private static double closestPass(Vec3 from, Facing facing, Vec3 target) {
    var arrow = new BowSolver.Arrow(from, facing.direction().scale(BowSolver.FULL_DRAW_SPEED));
    var best = Double.POSITIVE_INFINITY;
    for (var tick = 0; tick < 200; tick++) {
      var next = arrow.step();
      for (var t = 0.0; t <= 1; t += 0.05) {
        best = Math.min(best, arrow.pos().lerp(next.pos(), t).distance(target));
      }
      arrow = next;
      if (arrow.pos().y() < target.y() - 20) {
        break;
      }
    }
    return best;
  }

  @Test
  void hitsStationaryTargetsAtSeveralRanges() {
    var from = new Vec3(0, 1.62, 0);
    for (var range : new double[] {8, 20, 35}) {
      for (var rise : new double[] {-2, 0, 3}) {
        var target = new Vec3(range * 0.6, 1.62 + rise, range * 0.8);
        var pitch = BowSolver.solve(from, target, BowSolver.FULL_DRAW_SPEED);
        assertThat(pitch).as("range %s rise %s", range, rise).isPresent();
        var facing = new Facing(Facing.looking(from, target).yaw(), pitch.getAsDouble());
        assertThat(closestPass(from, facing, target))
            .as("range %s rise %s", range, rise)
            .isLessThan(0.35);
      }
    }
  }

  @Test
  void aimsAboveTheTargetToAllowForGravity() {
    var from = new Vec3(0, 1.62, 0);
    var target = new Vec3(0, 1.62, 30);
    var pitch = BowSolver.solve(from, target, BowSolver.FULL_DRAW_SPEED).orElseThrow();
    assertThat(pitch).isLessThan(0).isGreaterThan(-20);
  }

  @Test
  void refusesTargetsOutOfRange() {
    assertThat(BowSolver.solve(Vec3.ZERO, new Vec3(0, 0, 500), BowSolver.FULL_DRAW_SPEED))
        .isEmpty();
    assertThat(BowSolver.solve(Vec3.ZERO, new Vec3(0, 5, 0), BowSolver.FULL_DRAW_SPEED)).isEmpty();
  }

  @Test
  void flightTimeGrowsWithDistance() {
    assertThat(BowSolver.flightTicks(10, 3)).isLessThan(BowSolver.flightTicks(30, 3));
  }
}
