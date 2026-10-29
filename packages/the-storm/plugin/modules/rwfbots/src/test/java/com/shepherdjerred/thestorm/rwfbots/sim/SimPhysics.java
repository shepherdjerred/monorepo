package com.shepherdjerred.thestorm.rwfbots.sim;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementMotor;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.FallRisk;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;

/** Calibrated motor and capsule collisions for the diagnostic sim, never native Paper evidence. */
final class SimPhysics {
  private static final double RADIUS = 0.299;
  private static final double HEIGHT = 1.8;
  private static final double EPSILON = 1e-6;
  // Vanilla walks a grounded body up a ledge this high without a jump.
  private static final double STEP_HEIGHT = 0.6;
  // A stair's full block, climbed as its two half steps; the sim's grid has no stair shapes.
  private static final double STAIR_RISE = 1.0;
  private final NavArtifact nav;

  SimPhysics(NavArtifact nav) {
    this.nav = nav;
  }

  void steer(SimBody body, Vec3 heading) {
    body.heading = heading;
    body.carried = body.velocity;
    var slowdown = body.usingItem ? 0.2 : body.sneaking ? 0.3 : 1;
    var control =
        new MovementMotor.Control(
            heading,
            body.sprinting && body.traversal.maySprint(),
            body.onGround || water(body.pos),
            slowdown);
    body.velocity =
        body.hopping && !control.onGround()
            ? MovementMotor.hopAir(body.velocity, control)
            : MovementMotor.steer(body.velocity, control);
    if (water(body.pos))
      body.velocity = body.velocity.withY(MovementMotor.swimVertical(heading.y()));
  }

  void jump(SimBody body, long tick) {
    if (!body.onGround) return;
    body.velocity =
        MovementMotor.jump(
            body.velocity, body.sprinting && body.traversal.maySprint(), body.heading);
    body.jumpTick = tick;
    body.onGround = false;
  }

  /** A sprint jump along this tick's steering, as the Paper body launches one. */
  void hop(SimBody body, long tick) {
    if (!body.onGround || body.heading.horizontal().isZero()) return;
    body.velocity = MovementMotor.hop(body.carried, body.heading);
    body.jumpTick = tick;
    body.onGround = false;
    body.hopping = true;
  }

  void move(SimBody body, long tick) {
    var grounded = body.onGround || body.jumpTick == tick;
    var incoming = body.velocity;
    var distance = Math.max(Math.abs(incoming.y()), incoming.horizontal().length());
    var divisions = Math.max(1, (int) Math.ceil(distance / 0.2));
    var delta = incoming.scale(1.0 / divisions);
    body.onGround = false;
    for (var step = 0; step < divisions && body.alive; step++) {
      vertical(body, delta.y(), tick);
      horizontal(body, delta.horizontal());
      if (water(body.pos)) body.fallDistance = 0;
    }
    if (!body.alive) {
      body.velocity = Vec3.ZERO;
      return;
    }
    var submerged = water(body.pos);
    var friction = submerged ? 0.8 : grounded ? 0.546 : 0.91;
    var gravity = submerged ? 0.02 : slowFalling(body, tick) ? 0.01 : 0.08;
    var vertical = body.onGround ? 0 : (body.velocity.y() - gravity) * 0.98;
    body.velocity = new Vec3(body.velocity.x() * friction, vertical, body.velocity.z() * friction);
    if (body.pos.y() < nav.graph().bounds().origin().y() - 64) body.hurt(1000, tick);
  }

  private void vertical(SimBody body, double dy, long tick) {
    var floor = floor(body.pos, body.pos.y() + Math.min(0, dy));
    if (dy <= 0 && Double.isFinite(floor)) {
      body.fallDistance += Math.max(0, body.pos.y() - floor);
      body.pos = body.pos.withY(floor);
      body.onGround = true;
      body.hopping = false;
      body.velocity = body.velocity.withY(0);
      land(body, tick);
      return;
    }
    var next = body.pos.plus(0, dy, 0);
    if (clear(next)) {
      body.pos = next;
      body.fallDistance += Math.max(0, -dy);
    } else {
      body.velocity = body.velocity.withY(0);
    }
  }

  private void land(SimBody body, long tick) {
    if (body.fallDistance > 0 && !water(body.pos)) {
      var damage = FallRisk.damage(new Waypoint(body.pos, Hop.DROP), body.view(tick), tick);
      if (damage > 0) body.hurt(damage, tick);
    }
    body.fallDistance = 0;
  }

  private void horizontal(SimBody body, Vec3 delta) {
    if (clear(body.pos.plus(delta))) {
      body.pos = body.pos.plus(delta);
      return;
    }
    if (body.onGround && stepUp(body, delta)) return;
    var x = new Vec3(delta.x(), 0, 0);
    var z = new Vec3(0, 0, delta.z());
    if (clear(body.pos.plus(x))) body.pos = body.pos.plus(x);
    else body.velocity = new Vec3(0, body.velocity.y(), body.velocity.z());
    if (clear(body.pos.plus(z))) body.pos = body.pos.plus(z);
    else body.velocity = new Vec3(body.velocity.x(), body.velocity.y(), 0);
  }

  /**
   * A grounded body walks up a ledge no higher than vanilla's step, and up a stair the baked graph
   * walks up (a WALK edge rising a full block, which it builds only across a stair's lower half).
   */
  private boolean stepUp(SimBody body, Vec3 delta) {
    var rise = stairAhead(body.pos, delta) ? STAIR_RISE : STEP_HEIGHT;
    var raised = body.pos.plus(0, rise, 0);
    var moved = raised.plus(delta);
    if (!clear(raised) || !clear(moved)) return false;
    var landing = floor(moved, body.pos.y() + EPSILON);
    if (!Double.isFinite(landing)) return false;
    body.pos = moved.withY(landing);
    return true;
  }

  /** Whether the graph walks the body's node up a full block into the cell it is moving into. */
  private boolean stairAhead(Vec3 feet, Vec3 delta) {
    var graph = nav.graph();
    var node = graph.nodeAt(BlockPos.of(feet));
    if (node.isEmpty() || delta.isZero()) return false;
    var ahead = BlockPos.of(feet.plus(delta.normalized().scale(RADIUS + delta.length())));
    var from = node.getAsInt();
    for (var edge = graph.edgeStart(from); edge < graph.edgeEnd(from); edge++) {
      var target = graph.edgeTarget(edge);
      var cell = graph.cell(target);
      if (graph.edgeHop(edge) == Hop.WALK
          && cell.x() == ahead.x()
          && cell.z() == ahead.z()
          && graph.feet(target).y() - feet.y() > STEP_HEIGHT) return true;
    }
    return false;
  }

  private double floor(Vec3 feet, double lower) {
    var highest = Double.NEGATIVE_INFINITY;
    for (var x = cell(feet.x() - RADIUS); x <= cell(feet.x() + RADIUS); x++) {
      for (var z = cell(feet.z() - RADIUS); z <= cell(feet.z() + RADIUS); z++) {
        for (var y = cell(lower - 1); y <= cell(feet.y()); y++) {
          var top = top(new BlockPos(x, y, z));
          if (top >= lower - EPSILON && top <= feet.y() + EPSILON) highest = Math.max(highest, top);
        }
      }
    }
    return highest;
  }

  private boolean clear(Vec3 feet) {
    for (var x = cell(feet.x() - RADIUS); x <= cell(feet.x() + RADIUS); x++) {
      for (var z = cell(feet.z() - RADIUS); z <= cell(feet.z() + RADIUS); z++) {
        for (var y = cell(feet.y() + EPSILON); y <= cell(feet.y() + HEIGHT - EPSILON); y++) {
          var block = new BlockPos(x, y, z);
          if (outside(block) || top(block) > feet.y() + EPSILON) return false;
        }
      }
    }
    return true;
  }

  /** The graph retains actual bottom-slab support heights despite the coarse movement bitset. */
  private double top(BlockPos block) {
    if (!nav.grid().bounds().contains(block) || !nav.grid().blocksMovement(block))
      return Double.NEGATIVE_INFINITY;
    var above = block.up();
    var node = nav.graph().nodeAt(above);
    return node.isPresent()
        ? Math.min(above.y(), nav.graph().feet(node.getAsInt()).y())
        : above.y();
  }

  private boolean outside(BlockPos block) {
    var bounds = nav.grid().bounds();
    return block.y() >= bounds.origin().y() && !bounds.contains(block);
  }

  private boolean water(Vec3 pos) {
    return nav.graph().water().contains(BlockPos.of(pos));
  }

  private static boolean slowFalling(SimBody body, long tick) {
    return body.velocity.y() <= 0 && FallRisk.active(body.traversal.slowFallingUntilTick(), tick);
  }

  private static int cell(double coordinate) {
    return (int) Math.floor(coordinate);
  }
}
