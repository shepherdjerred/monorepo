package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.HealthRoutes;
import com.shepherdjerred.thestorm.rwfbots.domain.map.TraversalCosts;
import com.shepherdjerred.thestorm.rwfbots.domain.map.WaterRoutes;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementMotor;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.function.IntToDoubleFunction;

/** Combines certified graph primitives with virtual underwater source and goal depths. */
final class RouteNavigator {
  private RouteNavigator() {}

  record Endpoints(int from, int to, Vec3 source, Vec3 goal) {}

  record Tolls(TraversalRisk.Query risk, IntToDoubleFunction penalty) {}

  private record Candidate(List<Waypoint> points, double ticks, double cost) {
    Candidate {
      points = List.copyOf(points);
    }
  }

  static List<Waypoint> find(TacticsContext context, Endpoints endpoints, Tolls tolls) {
    var candidates = new ArrayList<Candidate>();
    var risk = tolls.risk().policy();
    graph(context, endpoints, tolls, risk).ifPresent(candidates::add);
    water(context, endpoints, tolls).ifPresent(candidates::add);
    var feasible =
        candidates.stream()
            .filter(candidate -> allows(risk, candidate.ticks()))
            .min(Comparator.comparingDouble(Candidate::cost));
    if (feasible.isPresent()) return feasible.orElseThrow().points();
    // A missed fuse deadline is an expected routing outcome. Still attempt the quickest safe
    // rescue.
    if (risk.deadlineTicks().isPresent()) {
      var unconstrained =
          new HealthRoutes.RiskPolicy(risk.damageBudget(), 0, OptionalDouble.empty());
      graph(context, endpoints, tolls, unconstrained).ifPresent(candidates::add);
    }
    return candidates.stream()
        .min(Comparator.comparingDouble(Candidate::ticks))
        .map(Candidate::points)
        .orElseGet(List::of);
  }

  private static boolean allows(HealthRoutes.RiskPolicy risk, double ticks) {
    return risk.deadlineTicks().isEmpty() || ticks <= risk.deadlineTicks().orElseThrow();
  }

  private static Optional<Candidate> graph(
      TacticsContext context, Endpoints endpoints, Tolls tolls, HealthRoutes.RiskPolicy policy) {
    var request =
        new HealthRoutes.Request(endpoints.from(), endpoints.to(), policy, tolls.penalty());
    var edges = tolls.risk().edges();
    var found = planned(context, endpoints, tolls, new Search(request, edges));
    if (found.isPresent() || !edges.timed()) return found;
    // Virtual depth legs can outlast an effect that protected the compressed portal route.
    var conservative =
        new HealthRoutes.EdgePolicy(
            edge -> edges.damage().damage(edge, (double) Long.MAX_VALUE), edges.motion());
    return planned(context, endpoints, tolls, new Search(request, conservative));
  }

  private record Search(HealthRoutes.Request request, HealthRoutes.EdgePolicy edges) {}

  private static Optional<Candidate> planned(
      TacticsContext context, Endpoints endpoints, Tolls tolls, Search search) {
    return context
        .route(search.request(), search.edges())
        .flatMap(
            route -> {
              var points = new ArrayList<Waypoint>();
              points.addAll(route.path().toFollow());
              if (submerged(context, endpoints.goal()))
                points.add(new Waypoint(endpoints.goal(), Hop.SWIM));
              return refine(context, endpoints.source(), points, tolls)
                  .flatMap(refined -> score(context, endpoints.source(), refined, tolls));
            });
  }

  private static Optional<Candidate> water(
      TacticsContext context, Endpoints endpoints, Tolls tolls) {
    return WaterRoutes.find(
            context.nav().graph().water(),
            context.nav().grid(),
            new WaterRoutes.Endpoints(endpoints.source(), endpoints.goal()),
            point -> penalty(context, tolls.penalty(), point))
        .map(route -> new Candidate(route.waypoints(), route.ticks(), route.weightedCost()));
  }

  private static Optional<List<Waypoint>> refine(
      TacticsContext context, Vec3 source, List<Waypoint> points, Tolls tolls) {
    var result = new ArrayList<Waypoint>();
    var previous = source;
    for (var index = 0; index < points.size(); index++) {
      var point = points.get(index);
      if (!refinable(context, previous, point)) {
        result.add(point);
        previous = point.pos();
        continue;
      }
      while (index + 1 < points.size() && refinable(context, point.pos(), points.get(index + 1)))
        point = points.get(++index);
      var route =
          WaterRoutes.find(
              context.nav().graph().water(),
              context.nav().grid(),
              new WaterRoutes.Endpoints(previous, point.pos()),
              pos -> penalty(context, tolls.penalty(), pos));
      if (route.isEmpty()) return Optional.empty();
      result.addAll(route.orElseThrow().waypoints());
      previous = point.pos();
    }
    return Optional.of(List.copyOf(result));
  }

  private static boolean refinable(TacticsContext context, Vec3 previous, Waypoint point) {
    return submerged(context, previous)
        && point.hop() == Hop.SWIM
        && submerged(context, point.pos())
        && !fluidInterface(context, previous, point.pos());
  }

  private static boolean fluidInterface(TacticsContext context, Vec3 from, Vec3 to) {
    var graph = context.nav().graph();
    var own = graph.water().at(BlockPos.of(from));
    var other = graph.water().at(BlockPos.of(to));
    if (own.isEmpty() || other.isEmpty()) return false;
    var left = own.orElseThrow();
    var right = other.orElseThrow();
    if (left.low().y() <= right.high() && right.low().y() <= left.high()) return false;
    var source = graph.nearestNode(from).orElseThrow();
    var target = graph.nearestNode(to).orElseThrow();
    for (var edge = graph.edgeStart(source); edge < graph.edgeEnd(source); edge++)
      if (graph.edgeTarget(edge) == target && graph.edgeHop(edge) == Hop.SWIM) return true;
    return false;
  }

  private static Optional<Candidate> score(
      TacticsContext context, Vec3 source, List<Waypoint> points, Tolls tolls) {
    double ticks = 0;
    double cost = 0;
    var damage = 0;
    var previous = source;
    for (var point : points) {
      var leg = leg(context, previous, point, tolls.risk());
      ticks += leg.ticks();
      if (leg.edge() >= 0)
        damage = Math.addExact(damage, tolls.risk().edges().damage().damage(leg.edge(), ticks));
      if (damage > tolls.risk().policy().damageBudget()) return Optional.empty();
      cost += leg.ticks() + penalty(context, tolls.penalty(), point.pos());
      previous = point.pos();
    }
    cost += damage * tolls.risk().policy().ticksPerHealthPoint();
    return Optional.of(new Candidate(points, ticks, cost));
  }

  private record Leg(double ticks, int edge) {}

  private static Leg leg(
      TacticsContext context, Vec3 from, Waypoint point, TraversalRisk.Query risk) {
    var graph = context.nav().graph();
    var source = graph.nearestNode(from);
    var target = graph.nearestNode(point.pos());
    if (point.hop() != Hop.SWIM && source.isPresent() && target.isPresent()) {
      for (var edge = graph.edgeStart(source.getAsInt());
          edge < graph.edgeEnd(source.getAsInt());
          edge++)
        if (graph.edgeTarget(edge) == target.getAsInt() && graph.edgeHop(edge) == point.hop())
          return new Leg(risk.edges().motion().duration().applyAsDouble(edge), edge);
    }
    if (point.hop() == Hop.LEAP || point.hop() == Hop.DROP)
      throw new IllegalStateException("damaging primitive lost its directed graph edge");
    return new Leg(virtualDuration(from, point, risk.sprint()), -1);
  }

  private static double virtualDuration(Vec3 from, Waypoint point, boolean sprint) {
    var horizontal = from.horizontalDistance(point.pos());
    var vertical = Math.abs(from.y() - point.pos().y());
    var speed = sprint ? MovementMotor.SPRINT_SPEED : MovementMotor.WALK_SPEED;
    return switch (point.hop()) {
      case WALK -> horizontal / speed;
      case JUMP -> TraversalCosts.STEP_JUMP;
      case LEAP -> throw new IllegalStateException("sprint jump lost its directed graph edge");
      case CLIMB ->
          Math.max(horizontal / MovementMotor.WALK_SPEED, vertical * TraversalCosts.CLIMB);
      case SWIM ->
          Math.max(horizontal / MovementMotor.WALK_SPEED, vertical * TraversalCosts.SWIM_VERTICAL);
      case DROP ->
          TraversalCosts.drop(Math.max(1, (int) Math.ceil(vertical)))
              - TraversalCosts.WALK
              + horizontal / speed;
    };
  }

  private static boolean submerged(TacticsContext context, Vec3 point) {
    return context.nav().graph().water().at(BlockPos.of(point)).isPresent();
  }

  private static double penalty(TacticsContext context, IntToDoubleFunction penalty, Vec3 point) {
    var node = context.nav().graph().nearestNode(point);
    if (node.isEmpty())
      throw new IllegalStateException("fluid point has no compressed graph portal");
    return penalty.applyAsDouble(node.getAsInt());
  }
}
