package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementMotor;
import java.util.OptionalInt;

/** Offline capsule sweeps of the calibrated controller, including launch momentum and landing. */
final class FlightCorridor {
  private final BlockClassification blocks;

  FlightCorridor(BlockClassification blocks) {
    this.blocks = blocks;
  }

  OptionalInt duration(BlockPos from, BlockPos to) {
    var direction = feet(to).minus(feet(from)).horizontal().normalized();
    var takeoff = feet(from).plus(direction.scale(LaunchData.TAKEOFF_OFFSET));
    if (!runUp(takeoff, direction)) return OptionalInt.empty();
    var point = takeoff;
    var velocity = MovementMotor.jump(direction.scale(MovementMotor.SPRINT_SPEED), true);
    for (var tick = 0; tick < 80; tick++) {
      var next = point.plus(velocity);
      var frame = new Frame(point, next, velocity, tick);
      if (shape(BlockPos.of(next)).swim() && shape(to).swim()) {
        return fluidArrival(frame, to);
      }
      if (velocity.y() <= 0 && next.y() <= feet(to).y() + 0.02) {
        return groundArrival(frame, to);
      }
      if (!sweep(point, next)) return OptionalInt.empty();
      var friction = tick == 0 ? 0.546 : 0.91;
      velocity =
          new Vec3(velocity.x() * friction, (velocity.y() - 0.08) * 0.98, velocity.z() * friction);
      velocity =
          MovementMotor.steer(
              velocity, new MovementMotor.Control(feet(to).minus(next), true, false, 1));
      point = next;
    }
    return OptionalInt.empty();
  }

  private record Frame(Vec3 point, Vec3 next, Vec3 velocity, int tick) {}

  private OptionalInt fluidArrival(Frame frame, BlockPos to) {
    if (!sweep(frame.point(), frame.next()) || !fluidCorridor(frame.next(), to.feet()))
      return OptionalInt.empty();
    var swim =
        Math.max(
            frame.next().horizontalDistance(to.feet()) / MovementMotor.WALK_SPEED,
            Math.abs(frame.next().y() - to.y()) * TraversalCosts.SWIM_VERTICAL);
    return OptionalInt.of(frame.tick() + 2 + (int) Math.ceil(swim));
  }

  private OptionalInt groundArrival(Frame frame, BlockPos to) {
    if (frame.point().y() < feet(to).y()) return OptionalInt.empty();
    var contact = new Vec3(frame.point().x(), feet(to).y(), frame.point().z());
    if (!caught(contact) || !sweep(frame.point(), contact)) return OptionalInt.empty();
    var landing = new Vec3(frame.next().x(), feet(to).y(), frame.next().z());
    if (!caught(landing) || !sweep(contact, landing)) return OptionalInt.empty();
    var settle = groundedArrival(landing, frame.velocity().horizontal(), feet(to));
    return settle.isPresent()
        ? OptionalInt.of(frame.tick() + 2 + settle.orElseThrow())
        : OptionalInt.empty();
  }

  private boolean runUp(Vec3 takeoff, Vec3 direction) {
    for (var distance = 0.0; distance <= LaunchData.RUN_UP; distance += 0.2) {
      var point = takeoff.minus(direction.scale(distance));
      if (!clear(point) || !supported(point)) return false;
    }
    return true;
  }

  private boolean supported(Vec3 point) {
    var min = BlockPos.of(point.plus(-0.299, -0.01, -0.299));
    var max = BlockPos.of(point.plus(0.299, -0.01, 0.299));
    for (var x = min.x(); x <= max.x(); x++)
      for (var z = min.z(); z <= max.z(); z++)
        if (!shape(new BlockPos(x, min.y(), z)).standable()) return false;
    return true;
  }

  /** Native collision can catch a landing when any part of the footprint overlaps support. */
  private boolean caught(Vec3 point) {
    var min = BlockPos.of(point.plus(-0.299, -0.01, -0.299));
    var max = BlockPos.of(point.plus(0.299, -0.01, 0.299));
    for (var x = min.x(); x <= max.x(); x++)
      for (var z = min.z(); z <= max.z(); z++)
        if (shape(new BlockPos(x, min.y(), z)).standable()) return true;
    return false;
  }

  private Vec3 feet(BlockPos cell) {
    return BlockFeet.at(blocks, cell);
  }

  /**
   * A broad platform may safely catch the body beyond its waypoint; certify the grounded return.
   */
  private OptionalInt groundedArrival(Vec3 start, Vec3 incoming, Vec3 goal) {
    var point = start;
    var velocity = incoming;
    for (var tick = 0; tick <= 30; tick++) {
      if (point.horizontalDistance(goal) <= 0.4) return OptionalInt.of(tick);
      velocity =
          MovementMotor.steer(
              velocity.scale(0.546), new MovementMotor.Control(goal.minus(point), true, true, 1));
      var next = point.plus(velocity);
      if (!caught(next) || !sweep(point, next)) return OptionalInt.empty();
      point = next;
    }
    return OptionalInt.empty();
  }

  private boolean sweep(Vec3 from, Vec3 to) {
    for (var fraction = 0.25; fraction <= 1; fraction += 0.25)
      if (!clear(from.plus(to.minus(from).scale(fraction)))) return false;
    return true;
  }

  private boolean fluidCorridor(Vec3 from, Vec3 to) {
    var divisions = Math.max(1, (int) Math.ceil(from.distance(to) / 0.2));
    for (var step = 0; step <= divisions; step++) {
      var point = from.plus(to.minus(from).scale((double) step / divisions));
      if (!shape(BlockPos.of(point)).swim() || !clear(point)) return false;
    }
    return true;
  }

  private boolean clear(Vec3 point) {
    var min = BlockPos.of(point.plus(-0.299, 0.001, -0.299));
    var max = BlockPos.of(point.plus(0.299, 1.799, 0.299));
    for (var x = min.x(); x <= max.x(); x++)
      for (var y = min.y(); y <= max.y(); y++)
        for (var z = min.z(); z <= max.z(); z++)
          if (collides(new BlockPos(x, y, z), point.y())) return false;
    return true;
  }

  private boolean collides(BlockPos cell, double feetY) {
    var material = shape(cell);
    return material.blocksMovement()
        && !(material == BlockShape.SLAB_BOTTOM && feetY >= cell.y() + 0.5);
  }

  private BlockShape shape(BlockPos cell) {
    return blocks.bounds().contains(cell)
        ? blocks.shape(cell.x(), cell.y(), cell.z())
        : BlockShape.FULL;
  }
}
