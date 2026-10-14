package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementMotor;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.Optional;

/** Bounded first-contact forecast, before the supported-node route is allowed to spend health. */
final class InitialLanding {
  private static final int MAX_TICKS = 1600;
  private static final double RADIUS = 0.299;

  private InitialLanding() {}

  record Contact(int node, Waypoint.Landing landing, double ticks, int damage) {}

  private record Hit(int node, Waypoint.Landing landing, Vec3 point) {}

  private record Progress(int tick, double descent) {}

  static boolean cancelsFall(NavGraph graph, Vec3 point) {
    return fluidOrClimb(graph, point).isPresent();
  }

  static Optional<Contact> find(NavArtifact nav, TraversalRisk.Query risk, Vec3 intent) {
    var found = trace(nav, risk, intent);
    // Execute towards the actual landing cell, rather than a distant steering target. Recheck
    // that this command has the same first contact; a changing/missing contact is not certified.
    for (var attempt = 0; attempt < 3 && found.isPresent(); attempt++) {
      var previous = found.orElseThrow();
      var next = trace(nav, risk, nav.graph().feet(previous.node()));
      if (next.isPresent() && same(previous, next.orElseThrow())) return next;
      found = next;
    }
    return Optional.empty();
  }

  private static boolean same(Contact left, Contact right) {
    return left.node() == right.node() && left.landing() == right.landing();
  }

  private static Optional<Contact> trace(NavArtifact nav, TraversalRisk.Query risk, Vec3 target) {
    var source = risk.source();
    var point = source.self().pos();
    var velocity = source.self().vel();
    var descent = 0.0;
    for (var tick = 0; tick < MAX_TICKS; tick++) {
      if (!validPosition(nav, point)) return Optional.empty();
      var immediate = fluidOrClimb(nav.graph(), point);
      if (immediate.isPresent())
        return contact(nav, source, immediate.orElseThrow(), new Progress(tick, descent));
      var gravity =
          FallRisk.active(source.self().traversal().slowFallingUntilTick(), at(source.tick(), tick))
              ? 0.01
              : 0.08;
      velocity =
          new Vec3(velocity.x() * 0.91, (velocity.y() - gravity) * 0.98, velocity.z() * 0.91);
      velocity =
          MovementMotor.steer(
              velocity, new MovementMotor.Control(target.minus(point), false, false, 1));
      var vertical = point.plus(0, velocity.y(), 0);
      var ground = ground(nav, point, vertical);
      var touched = verticalContact(nav, point, vertical, ground).or(() -> ground);
      if (touched.isPresent())
        return contact(
            nav,
            source,
            touched.orElseThrow(),
            new Progress(
                tick + 1, descent + Math.max(0, point.y() - touched.orElseThrow().point().y())));
      var next = vertical.plus(velocity.x(), 0, velocity.z());
      if (!sweep(nav, point, vertical) || !sweep(nav, vertical, next)) return Optional.empty();
      descent += Math.max(0, point.y() - vertical.y());
      var entered = fluidOrClimb(nav.graph(), next);
      if (entered.isPresent())
        return contact(nav, source, entered.orElseThrow(), new Progress(tick + 1, descent));
      point = next;
    }
    return Optional.empty();
  }

  private static boolean validPosition(NavArtifact nav, Vec3 point) {
    return nav.grid().bounds().contains(BlockPos.of(point)) && clear(nav, point);
  }

  private static Optional<Contact> contact(
      NavArtifact nav, TraversalRisk.Source source, Hit hit, Progress progress) {
    var feet = nav.graph().feet(hit.node());
    var settle =
        hit.point().horizontalDistance(feet) / MovementMotor.WALK_SPEED
            + Math.abs(hit.point().y() - feet.y()) / 0.08;
    var ticks = progress.tick() + settle;
    var damage =
        FallRisk.landingDamage(
            progress.descent(),
            hit.landing(),
            source.self().traversal(),
            at(source.tick(), progress.tick() + 2));
    return Optional.of(new Contact(hit.node(), hit.landing(), ticks, damage));
  }

  private static long at(long now, long elapsed) {
    return elapsed >= Long.MAX_VALUE - now ? Long.MAX_VALUE : now + elapsed;
  }

  private static Optional<Hit> verticalContact(
      NavArtifact nav, Vec3 from, Vec3 to, Optional<Hit> ground) {
    var divisions = Math.max(1, (int) Math.ceil(from.distance(to) / 0.1));
    for (var step = 1; step <= divisions; step++) {
      var point = from.plus(to.minus(from).scale((double) step / divisions));
      if (ground.isPresent() && point.y() <= ground.orElseThrow().point().y()) break;
      var entered = fluidOrClimb(nav.graph(), point);
      if (entered.isPresent() && sweep(nav, from, point)) return entered;
    }
    return Optional.empty();
  }

  private static Optional<Hit> fluidOrClimb(NavGraph graph, Vec3 point) {
    var cell = BlockPos.of(point);
    if (graph.water().contains(cell))
      return graph.nearestNode(point).stream()
          .mapToObj(node -> new Hit(node, Waypoint.Landing.WATER, point))
          .findFirst();
    var node = graph.nodeAt(cell);
    if (node.isEmpty()) return Optional.empty();
    return graph.climbable(node.getAsInt())
        ? Optional.of(new Hit(node.getAsInt(), Waypoint.Landing.CLIMB, point))
        : Optional.empty();
  }

  private static Optional<Hit> ground(NavArtifact nav, Vec3 from, Vec3 to) {
    if (to.y() > from.y()) return Optional.empty();
    Hit best = null;
    for (var x = (int) Math.floor(from.x() - RADIUS); x <= (int) Math.floor(from.x() + RADIUS); x++)
      for (var z = (int) Math.floor(from.z() - RADIUS);
          z <= (int) Math.floor(from.z() + RADIUS);
          z++)
        for (var y = (int) Math.floor(to.y()); y <= (int) Math.ceil(from.y()) + 1; y++) {
          var candidate = support(nav, new BlockPos(x, y, z), from, to);
          if (candidate.isPresent()
              && (best == null || candidate.orElseThrow().point().y() > best.point().y()))
            best = candidate.orElseThrow();
        }
    return Optional.ofNullable(best);
  }

  private static Optional<Hit> support(NavArtifact nav, BlockPos cell, Vec3 from, Vec3 to) {
    var node = nav.graph().nodeAt(cell);
    if (node.isEmpty() || nav.graph().water().contains(cell)) return Optional.empty();
    var feet = nav.graph().feet(node.getAsInt());
    if (feet.y() > from.y() + 0.001 || feet.y() < to.y()) return Optional.empty();
    if (!nav.grid().blocksMovement(BlockPos.of(feet.plus(0, -0.01, 0)))) return Optional.empty();
    var contact = new Vec3(from.x(), feet.y(), from.z());
    return sweep(nav, from, contact)
        ? Optional.of(new Hit(node.getAsInt(), Waypoint.Landing.GROUND, contact))
        : Optional.empty();
  }

  private static boolean sweep(NavArtifact nav, Vec3 from, Vec3 to) {
    var divisions = Math.max(1, (int) Math.ceil(from.distance(to) / 0.1));
    for (var step = 0; step <= divisions; step++)
      if (!clear(nav, from.plus(to.minus(from).scale((double) step / divisions)))) return false;
    return true;
  }

  private static boolean clear(NavArtifact nav, Vec3 point) {
    var min = BlockPos.of(point.plus(-RADIUS, 0.001, -RADIUS));
    var max = BlockPos.of(point.plus(RADIUS, 1.799, RADIUS));
    for (var x = min.x(); x <= max.x(); x++)
      for (var y = min.y(); y <= max.y(); y++)
        for (var z = min.z(); z <= max.z(); z++)
          if (collides(nav, new BlockPos(x, y, z), point.y())) return false;
    return true;
  }

  private static boolean collides(NavArtifact nav, BlockPos cell, double feetY) {
    if (!nav.grid().blocksMovement(cell)) return false;
    var above = nav.graph().nodeAt(cell.up());
    var top = above.isPresent() ? nav.graph().feet(above.getAsInt()).y() : cell.y() + 1;
    return feetY < top - 0.001;
  }
}
