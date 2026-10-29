package com.shepherdjerred.thestorm.tools.rwfmap;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockClassification;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavCodec;
import com.shepherdjerred.thestorm.rwfbots.domain.map.StairQuarters;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementMotor;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * A body walks hemispheres' blue bomb tower up its spiral stairs to the bomb deck along the baked
 * route, with vanilla's collision and its 0.6 step height against the real stair shapes: every
 * stair is a walk, and each jump the route asks for lands first time. Every stair step was a jump
 * before; a spotter hopped 122 times in a minute and a half at the first turn.
 */
final class TowerStairsTest {
  private static final BlockPos FOOT = new BlockPos(2108, 42, 3095);
  private static final BlockPos DECK = new BlockPos(2107, 61, 3095);
  private static final double HALF_WIDTH = 0.3;
  private static final double HEIGHT = 1.8;
  private static final double STEP_HEIGHT = 0.6;
  private static final double EPSILON = 1e-7;
  private static final int TICKS = 1200;

  @Test
  void aBodyWalksUpTheBlueTowerStairsToTheBombDeck() throws IOException {
    var map = MapFolder.load(ShippedMapsTest.MAPS.resolve("hemispheres"));
    var nav =
        switch (NavCodec.decode(Files.readAllBytes(map.navFile()))) {
          case Result.Ok(var value) -> value;
          case Result.Err(var error) -> throw new AssertionError(error.message());
        };
    var graph = nav.graph();
    var route =
        graph
            .path(graph.nodeAt(FOOT).orElseThrow(), graph.nodeAt(DECK).orElseThrow())
            .orElseThrow();
    var waypoints = route.toFollow();
    var stairs = 0;
    var jumps = 0;
    var previous = graph.feet(route.nodes().getFirst());
    for (var waypoint : waypoints) {
      assertThat(waypoint.hop()).as("route hop at %s", waypoint.pos()).isIn(Hop.WALK, Hop.JUMP);
      if (waypoint.hop() == Hop.WALK && waypoint.pos().y() - previous.y() > 0.9) stairs++;
      if (waypoint.hop() == Hop.JUMP) jumps++;
      previous = waypoint.pos();
    }
    assertThat(stairs).as("stair steps walked up").isGreaterThanOrEqualTo(12);

    var climb = new Body(map.classify(), graph.feet(route.nodes().getFirst())).follow(waypoints);
    assertThat(climb.reached())
        .as("waypoints reached of %d", waypoints.size())
        .isEqualTo(waypoints.size());
    assertThat(climb.jumps()).as("jumps, one for each the route asks for").isEqualTo(jumps);
    assertThat(climb.fall()).as("deepest fall below the highest footing").isLessThan(0.75);
  }

  private record Climb(int reached, int jumps, double fall) {}

  /** A vanilla-sized body steered at walking speed, with ground friction, gravity and step-up. */
  private static final class Body {
    private final BlockClassification blocks;
    private Vec3 pos;
    private Vec3 velocity = Vec3.ZERO;
    private boolean onGround = true;
    private boolean bumped;

    Body(BlockClassification blocks, Vec3 feet) {
      this.blocks = blocks;
      this.pos = feet;
    }

    Climb follow(List<Waypoint> waypoints) {
      var next = 0;
      var jumps = 0;
      var footing = pos.y();
      var fall = 0.0;
      for (var tick = 0; tick < TICKS && next < waypoints.size(); tick++) {
        var waypoint = waypoints.get(next);
        if (arrived(waypoint)) {
          next++;
          continue;
        }
        if (waypoint.hop() == Hop.JUMP
            && onGround
            && pos.horizontalDistance(waypoint.pos()) <= 1.2) {
          velocity = MovementMotor.jump(velocity, false);
          onGround = false;
          jumps++;
        }
        velocity =
            MovementMotor.steer(
                velocity, new MovementMotor.Control(waypoint.pos().minus(pos), false, onGround, 1));
        move(velocity);
        if (onGround) footing = Math.max(footing, pos.y());
        fall = Math.max(fall, footing - pos.y());
        var friction = onGround ? 0.546 : 0.91;
        // Vanilla stops vertical motion at a floor or a ceiling, and pulls every body down.
        var vertical = bumped ? 0 : velocity.y();
        velocity =
            new Vec3(velocity.x() * friction, (vertical - 0.08) * 0.98, velocity.z() * friction);
      }
      return new Climb(next, jumps, fall);
    }

    private boolean arrived(Waypoint waypoint) {
      return pos.horizontalDistance(waypoint.pos()) <= 0.45
          && Math.abs(pos.y() - waypoint.pos().y()) <= 0.65
          && (waypoint.hop() != Hop.JUMP || onGround);
    }

    /**
     * Vanilla's entity move: vertical, then across, and a step up when a grounded body is stopped.
     */
    private void move(Vec3 motion) {
      var grounded = onGround;
      var start = pos;
      var moved = collide(start, motion);
      bumped = Math.abs(moved.y() - motion.y()) > EPSILON;
      onGround = motion.y() < 0 && bumped;
      var across = Math.hypot(moved.x(), moved.z());
      var blocked =
          Math.abs(moved.x() - motion.x()) > EPSILON || Math.abs(moved.z() - motion.z()) > EPSILON;
      if ((grounded || onGround) && blocked) {
        var up = clip(start, 1, STEP_HEIGHT);
        var raised = start.plus(0, up, 0);
        var stepped = collide(raised, new Vec3(motion.x(), 0, motion.z()));
        var landed = raised.plus(stepped);
        var down = clip(landed, 1, -up);
        if (Math.hypot(stepped.x(), stepped.z()) > across + EPSILON) {
          pos = landed.plus(0, down, 0);
          onGround = true;
          return;
        }
      }
      pos = start.plus(moved);
    }

    private Vec3 collide(Vec3 from, Vec3 motion) {
      var dy = clip(from, 1, motion.y());
      var at = from.plus(0, dy, 0);
      var dx = clip(at, 0, motion.x());
      at = at.plus(dx, 0, 0);
      var dz = clip(at, 2, motion.z());
      return new Vec3(dx, dy, dz);
    }

    /** How far the body at {@code feet} moves along {@code axis} (x, y, z) before it collides. */
    private double clip(Vec3 feet, int axis, double offset) {
      if (offset == 0) return 0;
      var min = new double[] {feet.x() - HALF_WIDTH, feet.y(), feet.z() - HALF_WIDTH};
      var max = new double[] {feet.x() + HALF_WIDTH, feet.y() + HEIGHT, feet.z() + HALF_WIDTH};
      var lo = min.clone();
      var hi = max.clone();
      if (offset > 0) hi[axis] += offset;
      else lo[axis] += offset;
      var result = offset;
      for (var box : near(lo, hi)) {
        if (overlaps(box, min, max, axis))
          result = stop(result, box, new double[][] {min, max}, axis);
      }
      return result;
    }

    /** Every collision box in the cells the swept body ({@code lo} to {@code hi}) touches. */
    private List<double[]> near(double[] lo, double[] hi) {
      var found = new ArrayList<double[]>();
      for (var x = (int) Math.floor(lo[0]); x <= (int) Math.floor(hi[0]); x++) {
        for (var y = (int) Math.floor(lo[1]) - 1; y <= (int) Math.floor(hi[1]); y++) {
          for (var z = (int) Math.floor(lo[2]); z <= (int) Math.floor(hi[2]); z++)
            found.addAll(boxes(x, y, z));
        }
      }
      return found;
    }

    /** The {@code offset} along {@code axis} cut short where it would enter {@code box}. */
    private static double stop(double offset, double[] box, double[][] body, int axis) {
      var min = body[0];
      var max = body[1];
      if (offset > 0 && box[axis] >= max[axis] - EPSILON)
        return Math.min(offset, box[axis] - max[axis]);
      if (offset < 0 && box[axis + 3] <= min[axis] + EPSILON)
        return Math.max(offset, box[axis + 3] - min[axis]);
      return offset;
    }

    private static boolean overlaps(double[] box, double[] min, double[] max, int axis) {
      for (var other = 0; other < 3; other++) {
        if (other == axis) continue;
        if (box[other] >= max[other] - EPSILON || box[other + 3] <= min[other] + EPSILON)
          return false;
      }
      return true;
    }

    /** The cell's collision boxes as {minX, minY, minZ, maxX, maxY, maxZ}. */
    private List<double[]> boxes(int x, int y, int z) {
      var boxes = new ArrayList<double[]>();
      if (!blocks.bounds().contains(new BlockPos(x, y, z))) return boxes;
      switch (blocks.shape(x, y, z)) {
        case PASSABLE, LIQUID, LADDER, HAZARD, DOOR -> {}
        case SLAB_BOTTOM -> boxes.add(new double[] {x, y, z, x + 1, y + 0.5, z + 1});
        case SLAB_TOP -> boxes.add(new double[] {x, y + 0.5, z, x + 1, y + 1, z + 1});
        case FENCE -> boxes.add(new double[] {x, y, z, x + 1, y + 1.5, z + 1});
        case STAIRS -> {
          var low = blocks.halfStepQuarters(x, y, z);
          if (low == 0) {
            boxes.add(new double[] {x, y, z, x + 1, y + 1, z + 1});
          } else {
            boxes.add(new double[] {x, y, z, x + 1, y + 0.5, z + 1});
            var cell = new BlockPos(x, y, z);
            quarter(boxes, low, StairQuarters.NORTH_WEST, cell);
            quarter(boxes, low, StairQuarters.NORTH_EAST, cell);
            quarter(boxes, low, StairQuarters.SOUTH_WEST, cell);
            quarter(boxes, low, StairQuarters.SOUTH_EAST, cell);
          }
        }
        default -> boxes.add(new double[] {x, y, z, x + 1, y + 1, z + 1});
      }
      return boxes;
    }

    /** The tall quarter {@code bit} of a stair at {@code cell}, unless it is a half step. */
    private static void quarter(List<double[]> boxes, int low, int bit, BlockPos cell) {
      if ((low & bit) != 0) return;
      var east = (bit & (StairQuarters.NORTH_EAST | StairQuarters.SOUTH_EAST)) != 0 ? 0.5 : 0;
      var south = (bit & (StairQuarters.SOUTH_WEST | StairQuarters.SOUTH_EAST)) != 0 ? 0.5 : 0;
      var x = cell.x() + east;
      var z = cell.z() + south;
      boxes.add(new double[] {x, cell.y() + 0.5, z, x + 0.5, cell.y() + 1, z + 0.5});
    }
  }
}
