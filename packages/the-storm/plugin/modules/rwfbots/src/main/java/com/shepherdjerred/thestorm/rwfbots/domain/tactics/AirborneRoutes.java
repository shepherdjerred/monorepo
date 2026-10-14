package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;

/** A pending fall is a virtual first leg, never a free projection onto a supported graph node. */
final class AirborneRoutes {
  private static final int WATER_RADIUS = 4;

  private AirborneRoutes() {}

  static List<Waypoint> find(
      TacticsContext context, RouteNavigator.Endpoints endpoints, RouteNavigator.Tolls tolls) {
    var intents = new ArrayList<Vec3>();
    intents.add(endpoints.goal());
    intents.add(context.nav().graph().feet(endpoints.from()));
    intents.addAll(nearbyWater(context.nav(), endpoints.source()));
    var candidates = new ArrayList<RouteNavigator.Candidate>();
    var visited = new HashSet<Integer>();
    for (var intent : intents) {
      var contact = InitialLanding.find(context.nav(), tolls.risk(), intent);
      if (contact.isEmpty() || !visited.add(contact.orElseThrow().node())) continue;
      continueFrom(context, endpoints, tolls, contact.orElseThrow()).ifPresent(candidates::add);
    }
    var deadline = tolls.risk().policy().deadlineTicks();
    var feasible =
        candidates.stream()
            .filter(candidate -> deadline.isEmpty() || candidate.ticks() <= deadline.orElseThrow())
            .min(Comparator.comparingDouble(RouteNavigator.Candidate::cost));
    return feasible
        .or(
            () ->
                candidates.stream()
                    .min(Comparator.comparingDouble(RouteNavigator.Candidate::ticks)))
        .map(RouteNavigator.Candidate::points)
        .orElseGet(List::of);
  }

  private static Optional<RouteNavigator.Candidate> continueFrom(
      TacticsContext context,
      RouteNavigator.Endpoints endpoints,
      RouteNavigator.Tolls tolls,
      InitialLanding.Contact contact) {
    if (contact.damage() > tolls.risk().policy().damageBudget()) return Optional.empty();
    var graph = context.nav().graph();
    var start = graph.feet(contact.node());
    var risk = TraversalRisk.afterLanding(tolls.risk(), graph, contact);
    var remaining = new RouteNavigator.Tolls(risk, tolls.penalty());
    var path =
        RouteNavigator.find(
            context,
            new RouteNavigator.Endpoints(contact.node(), endpoints.to(), start, endpoints.goal()),
            remaining);
    if (path.isEmpty() && contact.node() != endpoints.to()) return Optional.empty();
    return RouteNavigator.score(context, start, path, remaining)
        .map(
            route -> {
              var points = new ArrayList<Waypoint>();
              points.add(
                  new Waypoint(
                      start,
                      contact.landing() == Waypoint.Landing.CLIMB ? Hop.CLIMB : Hop.DROP,
                      Optional.empty(),
                      contact.landing()));
              points.addAll(route.points());
              var prefixCost =
                  contact.ticks()
                      + contact.damage() * tolls.risk().policy().ticksPerHealthPoint()
                      + RouteNavigator.densityCost(
                          context,
                          tolls,
                          new RouteNavigator.Span(endpoints.source(), start, contact.ticks()));
              return new RouteNavigator.Candidate(
                  points, contact.ticks() + route.ticks(), prefixCost + route.cost());
            });
  }

  private static List<Vec3> nearbyWater(NavArtifact nav, Vec3 source) {
    var water = new ArrayList<Vec3>();
    var center = BlockPos.of(source);
    for (var dx = -WATER_RADIUS; dx <= WATER_RADIUS; dx++)
      for (var dz = -WATER_RADIUS; dz <= WATER_RADIUS; dz++)
        waterInColumn(nav, center.offset(dx, 0, dz)).ifPresent(water::add);
    return water.stream()
        .sorted(Comparator.comparingDouble(source::horizontalDistance))
        .limit(2)
        .toList();
  }

  private static Optional<Vec3> waterInColumn(NavArtifact nav, BlockPos column) {
    var bounds = nav.grid().bounds();
    for (var y = Math.min(column.y(), bounds.origin().y() + bounds.sizeY() - 1);
        y >= bounds.origin().y();
        y--) {
      var cell = new BlockPos(column.x(), y, column.z());
      if (nav.graph().water().contains(cell)) return Optional.of(cell.feet());
    }
    return Optional.empty();
  }
}
