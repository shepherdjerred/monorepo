package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.HealthRoutes;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.map.TraversalCosts;
import com.shepherdjerred.thestorm.rwfbots.domain.map.TraversalDensity;
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

  /**
   * A route the bot could take.
   *
   * @param points its waypoints
   * @param ticks how long it takes
   * @param cost what it costs the bot: time, tolls and the health it loses, weighted
   * @param damage the health it loses to falls, in health points
   */
  record Candidate(List<Waypoint> points, double ticks, double cost, int damage) {
    Candidate {
      points = List.copyOf(points);
    }

    /** A route that costs no health. */
    Candidate(List<Waypoint> points, double ticks, double cost) {
      this(points, ticks, cost, 0);
    }
  }

  /**
   * The most health a route away from a lit fuse spends on falls when a gentler way exists: two
   * hearts. Pricing health alone sent bots off 7-damage spawn ledges on cors-path to save two
   * seconds and down a 21-block shaft on beanstalk (18 damage) past its stairs.
   */
  static final int GENTLE_FALLS = 4;

  /** How much longer, in ticks, the gentler way may take before the hurtful one is taken. */
  static final double GENTLE_DETOUR = TraversalCosts.walkingTicks(80);

  static List<Waypoint> find(TacticsContext context, Endpoints endpoints, Tolls query) {
    var tolls =
        new Tolls(
            query.risk(),
            TraversalDensity.memoized(context.nav().graph().nodeCount(), query.penalty()));
    var self = tolls.risk().source().self();
    if (self.traversal().fallDistance() > 0) {
      // A body standing on solid ground has landed whatever its reported fall distance says.
      if (self.onGround() || InitialLanding.cancelsFall(context.nav().graph(), endpoints.source()))
        return find(
            context,
            endpoints,
            new Tolls(TraversalRisk.afterCancellation(tolls.risk()), tolls.penalty()));
      return AirborneRoutes.find(context, endpoints, tolls);
    }
    var candidates = new ArrayList<Candidate>();
    var risk = tolls.risk().policy();
    gentle(context, endpoints, tolls, graph(context, endpoints, tolls, risk))
        .ifPresent(candidates::add);
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

  /**
   * The gentler way when {@code hurtful} falls further than {@link #GENTLE_FALLS} and a lit fuse is
   * not waiting: the cheapest route within that much fall damage, unless it takes {@link
   * #GENTLE_DETOUR} longer. A fuse to beat spends whatever health its budget allows.
   */
  private static Optional<Candidate> gentle(
      TacticsContext context, Endpoints endpoints, Tolls tolls, Optional<Candidate> hurtful) {
    var risk = tolls.risk().policy();
    if (hurtful.isEmpty()
        || hurtful.orElseThrow().damage() <= GENTLE_FALLS
        || risk.deadlineTicks().isPresent()) return hurtful;
    var gentle =
        graph(
            context,
            endpoints,
            tolls,
            risk.withDamageBudget(Math.min(risk.damageBudget(), GENTLE_FALLS)));
    return gentle
        .filter(route -> route.ticks() <= hurtful.orElseThrow().ticks() + GENTLE_DETOUR)
        .or(() -> hurtful);
  }

  private static boolean allows(HealthRoutes.RiskPolicy risk, double ticks) {
    return risk.deadlineTicks().isEmpty() || ticks <= risk.deadlineTicks().orElseThrow();
  }

  private static Optional<Candidate> graph(
      TacticsContext context, Endpoints endpoints, Tolls tolls, HealthRoutes.RiskPolicy policy) {
    var request = new HealthRoutes.Request(endpoints.from(), endpoints.to(), policy, node -> 0);
    var density = TraversalDensity.edges(context.nav().graph(), tolls.penalty());
    var edges = tolls.risk().edges().withToll(trapped(context, density));
    var found = planned(context, endpoints, tolls, new Search(request, edges));
    if (found.isPresent() || !edges.timed()) return found;
    // Virtual depth legs can outlast an effect that protected the compressed portal route.
    var conservative =
        new HealthRoutes.EdgePolicy(
                edge -> edges.damage().damage(edge, (double) Long.MAX_VALUE), edges.motion())
            .withToll(edges.toll());
    return planned(context, endpoints, tolls, new Search(request, conservative));
  }

  private record Search(HealthRoutes.Request request, HealthRoutes.EdgePolicy edges) {}

  /**
   * What a drop costs on top of its time when it lands where only sprint jumps lead back out (see
   * {@link com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact#leapOnlyExit}): a missed jump
   * on the way out drops the bot back in, and one that may not sprint is stuck there.
   */
  static final double LEAP_TRAP_TOLL = TraversalCosts.walkingTicks(64);

  /** {@code base} with {@link #LEAP_TRAP_TOLL} on every drop into a leap-only pocket. */
  static NavGraph.EdgeToll trapped(TacticsContext context, NavGraph.EdgeToll base) {
    var graph = context.nav().graph();
    var pocket = context.nav().leapOnlyExits();
    return (edge, source, duration) ->
        base.cost(edge, source, duration)
            + (graph.edgeHop(edge) == Hop.DROP
                    && pocket.test(graph.edgeTarget(edge))
                    && !pocket.test(source)
                ? LEAP_TRAP_TOLL
                : 0);
  }

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
              else if (points.isEmpty()
                  && endpoints
                          .source()
                          .horizontalDistance(context.nav().graph().feet(endpoints.to()))
                      > 0) {
                // Sharing a graph cell does not mean the body has reached its cover point.
                points.add(new Waypoint(context.nav().graph().feet(endpoints.to()), Hop.WALK));
              }
              return refine(context, endpoints.source(), points, tolls)
                  .flatMap(refined -> score(context, endpoints.source(), refined, tolls));
            });
  }

  private static Optional<Candidate> water(
      TacticsContext context, Endpoints endpoints, Tolls tolls) {
    return WaterRoutes.findDensity(
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
          WaterRoutes.findDensity(
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

  /**
   * What following {@code points} from {@code source} costs: time, density, the {@link
   * #LEAP_TRAP_TOLL} the graph search charged for each drop into a leap-only pocket, and health. A
   * graph route that drops into a pocket anyway carries that toll when {@link #find} weighs it
   * against the water route.
   */
  static Optional<Candidate> score(
      TacticsContext context, Vec3 source, List<Waypoint> points, Tolls tolls) {
    var trap = trapped(context, (edge, from, duration) -> 0);
    double ticks = 0;
    double cost = 0;
    var damage = 0;
    var previous = source;
    for (var point : points) {
      var leg = leg(context, previous, point, tolls.risk());
      ticks += leg.ticks();
      if (leg.edge() >= 0) {
        damage = Math.addExact(damage, tolls.risk().edges().damage().damage(leg.edge(), ticks));
        cost += trap.cost(leg.edge(), leg.from(), leg.ticks());
      }
      if (damage > tolls.risk().policy().damageBudget()) return Optional.empty();
      cost +=
          leg.ticks() + densityCost(context, tolls, new Span(previous, point.pos(), leg.ticks()));
      previous = point.pos();
    }
    cost += damage * tolls.risk().policy().ticksPerHealthPoint();
    return Optional.of(new Candidate(points, ticks, cost, damage));
  }

  /** A leg's time, and the graph edge it follows from node {@code from} (both -1 off the graph). */
  private record Leg(double ticks, int edge, int from) {}

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
          return new Leg(
              risk.edges().motion().duration().applyAsDouble(edge), edge, source.getAsInt());
    }
    if (point.hop() == Hop.LEAP || point.hop() == Hop.DROP)
      throw new IllegalStateException("damaging primitive lost its directed graph edge");
    return new Leg(virtualDuration(from, point, risk.sprint()), -1, -1);
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

  record Span(Vec3 from, Vec3 to, double ticks) {}

  static double densityCost(TacticsContext context, Tolls tolls, Span span) {
    return TraversalDensity.cost(
        penalty(context, tolls.penalty(), span.from()),
        penalty(context, tolls.penalty(), span.to()),
        span.ticks());
  }

  private static double penalty(TacticsContext context, IntToDoubleFunction penalty, Vec3 point) {
    var node = context.nav().graph().nearestNode(point);
    if (node.isEmpty())
      throw new IllegalStateException("fluid point has no compressed graph portal");
    return penalty.applyAsDouble(node.getAsInt());
  }
}
