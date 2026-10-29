package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import java.util.BitSet;
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
  void reachesTheLongestBandAnArcherEngagesAt() {
    var from = new Vec3(0, 1.62, 0);
    for (var range : new double[] {40, 48, 55}) {
      for (var rise : new double[] {-4, 0, 4}) {
        var target = new Vec3(range * 0.8, 1.62 + rise, range * 0.6);
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

  @Test
  void aJumpingTargetIsLedAlongTheGroundAndAimedAtWhereItWillLand() {
    var bounds = new GridBounds(new BlockPos(0, 0, 0), 32, 8, 8);
    var floor = new BitSet(bounds.volume());
    for (var x = 0; x < 32; x++) for (var z = 0; z < 8; z++) floor.set(bounds.index(x, 0, z));
    var grid = new VoxelGrid(bounds, floor, floor, floor);
    // Mid-jump, rising 0.4 a tick: leading that for 12 ticks aimed nearly five blocks high.
    var jumping =
        Fixtures.combatant(2, Fixtures.BLUE, new Vec3(10.5, 1.8, 3.5))
            .withVel(new Vec3(0.28, 0.4, 0))
            .withMotion(true, false);
    var aim = BowSolver.lead(grid, jumping, 12);
    assertThat(aim.x()).isCloseTo(10.5 + 12 * 0.28, within(1e-9));
    assertThat(aim.y()).isCloseTo(1 + BowSolver.BODY_CENTRE, within(1e-9));
    // On the ground the aim keeps its feet height; over a drop it keeps its own height.
    var running = jumping.withPos(new Vec3(10.5, 1, 3.5)).withMotion(true, true);
    assertThat(BowSolver.lead(grid, running, 12).y()).isCloseTo(2.3, within(1e-9));
    var overVoid = jumping.withPos(new Vec3(10.5, 1.8, 30));
    assertThat(BowSolver.lead(grid, overVoid, 12).y()).isCloseTo(1.8 + 1.3, within(1e-9));
    // Higher above the ground than any jump lifts, a target climbs, swims or falls: aim at it.
    var climbing = jumping.withPos(new Vec3(10.5, 4.5, 3.5)).withVel(new Vec3(0, 0.1, 0));
    assertThat(BowSolver.lead(grid, climbing, 12).y()).isCloseTo(4.5 + 1.3, within(1e-9));
  }
}
