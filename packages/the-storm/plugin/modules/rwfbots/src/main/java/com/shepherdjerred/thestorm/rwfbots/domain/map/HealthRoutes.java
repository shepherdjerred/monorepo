package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.PriorityQueue;
import java.util.function.IntToDoubleFunction;
import java.util.function.IntUnaryOperator;
import org.jspecify.annotations.Nullable;

/**
 * Exact shortest routes under a cumulative health-point budget, including safer alternate prefixes.
 */
public final class HealthRoutes {
  /**
   * Leeway, in ticks, on the remaining-time bound, so float rounding in it never drops a label that
   * would arrive just in time.
   */
  private static final double LATE_SLACK = 1;

  private HealthRoutes() {}

  /** Damage budget is available health minus the health the caller requires on arrival. */
  public record RiskPolicy(
      double damageBudget, double ticksPerHealthPoint, OptionalDouble deadlineTicks) {
    public RiskPolicy(double damageBudget, double ticksPerHealthPoint) {
      this(damageBudget, ticksPerHealthPoint, OptionalDouble.empty());
    }

    public RiskPolicy {
      if (!Double.isFinite(damageBudget) || damageBudget < 0)
        throw new IllegalArgumentException("damage budget must be finite and non-negative");
      if (!Double.isFinite(ticksPerHealthPoint) || ticksPerHealthPoint < 0)
        throw new IllegalArgumentException("health cost must be finite and non-negative");
      if (deadlineTicks.isPresent()
          && (!Double.isFinite(deadlineTicks.orElseThrow()) || deadlineTicks.orElseThrow() < 0))
        throw new IllegalArgumentException("arrival deadline must be finite and non-negative");
    }

    /** The same policy with a different damage budget. */
    public RiskPolicy withDamageBudget(double budget) {
      return new RiskPolicy(budget, ticksPerHealthPoint, deadlineTicks);
    }

    boolean allows(double ticks) {
      return deadlineTicks.isEmpty() || ticks <= deadlineTicks.orElseThrow();
    }
  }

  public enum PenaltyUnits {
    NODE,
    BLOCK
  }

  public record Request(
      int from, int to, RiskPolicy risk, IntToDoubleFunction penalty, PenaltyUnits penaltyUnits) {
    public Request(int from, int to, RiskPolicy risk, IntToDoubleFunction penalty) {
      this(from, to, risk, penalty, PenaltyUnits.NODE);
    }

    public Request(int from, int to, double damageBudget, IntToDoubleFunction penalty) {
      this(from, to, new RiskPolicy(damageBudget, 0), penalty);
    }

    public double damageBudget() {
      return risk.damageBudget();
    }

    private double transitionPenalty(NavGraph graph, int source, int target) {
      var scale =
          penaltyUnits == PenaltyUnits.BLOCK
              ? Math.max(1, graph.feet(source).distance(graph.feet(target)))
              : 1;
      return checkedPenalty(penalty, target) * scale;
    }
  }

  /** The accepted path and the conservative predicted cumulative damage in health points. */
  public record Route(NavPath path, int damage, double weightedCost) {}

  @FunctionalInterface
  public interface DamageAt {
    int damage(int edge, double arrivalTicks);
  }

  public record EdgePolicy(
      DamageAt damage, NavGraph.EdgeMotion motion, boolean timed, NavGraph.EdgeToll toll) {
    public EdgePolicy(DamageAt damage, NavGraph.EdgeMotion motion, boolean timed) {
      this(damage, motion, timed, (edge, source, duration) -> 0);
    }

    public EdgePolicy(IntUnaryOperator damage, NavGraph.EdgeMotion motion) {
      this((edge, arrival) -> damage.applyAsInt(edge), motion, false);
    }

    public static EdgePolicy timed(DamageAt damage, NavGraph.EdgeMotion motion) {
      return new EdgePolicy(damage, motion, true);
    }

    public EdgePolicy withToll(NavGraph.EdgeToll value) {
      return new EdgePolicy(damage, motion, timed, value);
    }
  }

  /**
   * Keeps the ordinary search as the fast path when its chosen route is safe. The supplied edge
   * damage must be a conservative whole-health-point bound for the current motor.
   */
  public static Optional<Route> find(NavGraph graph, Request request, IntUnaryOperator edgeDamage) {
    return find(graph, request, edgeDamage, null);
  }

  /** Reuses ordinary search scratch for the common case whose cheapest route already fits. */
  public static Optional<Route> find(
      NavGraph graph,
      Request request,
      IntUnaryOperator edgeDamage,
      NavGraph.@Nullable SearchWorkspace workspace) {
    return find(
        graph,
        request,
        new EdgePolicy(edgeDamage, new NavGraph.EdgeMotion(graph::edgeCost, edge -> true, 1)),
        workspace);
  }

  public static Optional<Route> find(
      NavGraph graph,
      Request request,
      EdgePolicy edges,
      NavGraph.@Nullable SearchWorkspace workspace) {
    if (request.from() < 0
        || request.from() >= graph.nodeCount()
        || request.to() < 0
        || request.to() >= graph.nodeCount())
      throw new IllegalArgumentException("route endpoint outside graph");
    if (edges.timed()) return new Search(graph, request, edges).find();
    var weights =
        new NavGraph.PathWeights(
            node -> 0,
            (edge, source, duration) ->
                checkedDamage(edges.damage(), edge, 0) * request.risk().ticksPerHealthPoint()
                    + request.transitionPenalty(graph, source, graph.edgeTarget(edge))
                    + checkedToll(edges.toll(), edge, source, duration),
            edges.motion());
    var scratch = workspace == null ? graph.workspace() : workspace;
    var unconstrained = graph.weightedPath(request.from(), request.to(), weights, scratch);
    if (unconstrained.isEmpty()) return Optional.empty();
    var weighted = unconstrained.orElseThrow();
    var ordinary = weighted.path();
    var damage = damage(graph, ordinary, edges.damage());
    if (damage <= request.damageBudget() && request.risk().allows(ordinary.cost())) {
      return Optional.of(new Route(ordinary, damage, weighted.weightedCost()));
    }
    return new Search(graph, request, edges).find();
  }

  private static int damage(NavGraph graph, NavPath path, DamageAt edgeDamage) {
    var damage = 0;
    for (var index = 1; index < path.nodes().size(); index++) {
      var from = path.nodes().get(index - 1);
      var to = path.nodes().get(index);
      var hop = path.waypoints().get(index).hop();
      damage = Math.addExact(damage, hopDamage(graph, new HopRequest(from, to, hop), edgeDamage));
    }
    return damage;
  }

  private record HopRequest(int from, int to, Hop hop) {}

  private static int hopDamage(NavGraph graph, HopRequest request, DamageAt edgeDamage) {
    var worst = -1;
    for (var edge = graph.edgeStart(request.from()); edge < graph.edgeEnd(request.from()); edge++) {
      if (graph.edgeTarget(edge) == request.to() && graph.edgeHop(edge) == request.hop())
        worst = Math.max(worst, checkedDamage(edgeDamage, edge, 0));
    }
    if (worst < 0) throw new IllegalStateException("path hop is not an edge in its graph");
    return worst;
  }

  private static int checkedDamage(DamageAt damage, int edge, double arrivalTicks) {
    var value = damage.damage(edge, arrivalTicks);
    if (value < 0) throw new IllegalArgumentException("edge damage must be non-negative");
    return value;
  }

  private static double checkedPenalty(IntToDoubleFunction penalty, int node) {
    var value = penalty.applyAsDouble(node);
    if (!Double.isFinite(value) || value < 0)
      throw new IllegalArgumentException("node penalty must be finite and non-negative");
    return value;
  }

  private static double checkedToll(NavGraph.EdgeToll toll, int edge, int source, double duration) {
    var value = toll.cost(edge, source, duration);
    if (!Double.isFinite(value) || value < 0)
      throw new IllegalArgumentException("edge toll must be finite and non-negative");
    return value;
  }

  private static final class Label {
    final int node;
    final int damage;
    final double cost;
    final double ticks;
    final int edge;
    final Optional<Label> previous;

    Label(int node, int damage, double cost, Prefix prefix) {
      this.node = node;
      this.damage = damage;
      this.cost = cost;
      this.ticks = prefix.ticks();
      this.edge = prefix.edge();
      this.previous = prefix.previous();
    }

    boolean dominates(Label other, boolean arrivalMatters) {
      // A static query without a deadline has no future use for a dearer, faster prefix.
      // Keep the existing time preference when prefix costs tie.
      return damage <= other.damage
          && cost <= other.cost
          && ((!arrivalMatters && cost < other.cost) || ticks <= other.ticks);
    }
  }

  private record Prefix(int edge, Optional<Label> previous, double ticks) {}

  private static final class Search {
    private final NavGraph graph;
    private final Request request;
    private final EdgePolicy edges;
    private final boolean arrivalMatters;

    /**
     * The least time from each node to the goal while it fits the deadline, or empty without a
     * deadline: a label that cannot arrive in time even at that pace is never offered.
     */
    private final double[] remaining;

    private final Map<Integer, List<Label>> frontier = new HashMap<>();
    private final PriorityQueue<Label> open =
        new PriorityQueue<>(
            (left, right) -> {
              var cost = Double.compare(left.cost, right.cost);
              if (cost != 0) return cost;
              var damage = Integer.compare(left.damage, right.damage);
              return damage != 0 ? damage : Integer.compare(left.node, right.node);
            });

    Search(NavGraph graph, Request request, EdgePolicy edges) {
      this.graph = graph;
      this.request = request;
      this.edges = edges;
      arrivalMatters = edges.timed() || request.risk().deadlineTicks().isPresent();
      var deadline = request.risk().deadlineTicks();
      remaining =
          deadline.isPresent()
              ? remainingTicks(graph, request.to(), edges.motion(), deadline.orElseThrow())
              : new double[0];
    }

    Optional<Route> find() {
      if (!inTime(request.from(), 0)) return Optional.empty();
      offer(new Label(request.from(), 0, 0, new Prefix(-1, Optional.empty(), 0)));
      while (!open.isEmpty()) {
        var current = open.remove();
        if (!Objects.requireNonNull(frontier.get(current.node), "queued node has no labels")
            .contains(current)) continue;
        if (current.node == request.to()) return Optional.of(reconstruct(current));
        for (var edge = graph.edgeStart(current.node); edge < graph.edgeEnd(current.node); edge++)
          relax(current, edge);
      }
      return Optional.empty();
    }

    private void relax(Label current, int edge) {
      if (!edges.motion().allowed().test(edge)) return;
      var duration = edges.motion().duration().applyAsDouble(edge);
      if (!Double.isFinite(duration) || duration < 0)
        throw new IllegalArgumentException("motion duration must be finite and non-negative");
      var ticks = current.ticks + duration;
      var node = graph.edgeTarget(edge);
      if (!inTime(node, ticks)) return;
      var edgeDamage = checkedDamage(edges.damage(), edge, ticks);
      var totalDamage = Math.addExact(current.damage, edgeDamage);
      if (totalDamage > request.damageBudget()) return;
      var penalty = request.transitionPenalty(graph, current.node, node);
      var riskCost = edgeDamage * request.risk().ticksPerHealthPoint();
      offer(
          new Label(
              node,
              totalDamage,
              current.cost
                  + duration
                  + penalty
                  + riskCost
                  + checkedToll(edges.toll(), edge, current.node, duration),
              new Prefix(edge, Optional.of(current), ticks)));
    }

    /** Whether a label at {@code node} after {@code ticks} can still reach the goal in time. */
    private boolean inTime(int node, double ticks) {
      return request.risk().allows(ticks)
          && (remaining.length == 0
              || ticks + remaining[node]
                  <= request.risk().deadlineTicks().orElseThrow() + LATE_SLACK);
    }

    private void offer(Label candidate) {
      var labels = frontier.computeIfAbsent(candidate.node, node -> new ArrayList<>());
      for (var label : labels) if (label.dominates(candidate, arrivalMatters)) return;
      labels.removeIf(label -> candidate.dominates(label, arrivalMatters));
      labels.add(candidate);
      open.add(candidate);
    }

    private Route reconstruct(Label goal) {
      var nodes = new ArrayList<Integer>();
      var waypoints = new ArrayList<Waypoint>();
      var current = goal;
      while (current.previous.isPresent()) {
        nodes.add(current.node);
        waypoints.add(graph.waypoint(current.edge));
        current = current.previous.orElseThrow();
      }
      nodes.add(current.node);
      waypoints.add(new Waypoint(graph.feet(current.node), Hop.WALK));
      Collections.reverse(nodes);
      Collections.reverse(waypoints);
      // NavPath.cost contains terrain time alone; discretionary penalties only choose the route.
      return new Route(new NavPath(nodes, waypoints, goal.ticks), goal.damage, goal.cost);
    }
  }

  /**
   * The least physical time from each node to {@code goal} over the edges the motion allows: a
   * reverse Dijkstra on time alone, which no damage or toll can shorten. It stops past the
   * deadline, leaving every later node at or above it. With it a bot that can no longer make a lit
   * fuse is turned away at once, instead of settling every state the deadline admits across most of
   * a large map first.
   */
  private static double[] remainingTicks(
      NavGraph graph, int goal, NavGraph.EdgeMotion motion, double deadline) {
    var remaining = new double[graph.nodeCount()];
    Arrays.fill(remaining, Double.POSITIVE_INFINITY);
    remaining[goal] = 0;
    var open = new MinHeap(64);
    open.push(0, goal);
    while (!open.isEmpty()) {
      var key = open.peekKey();
      var node = open.pop();
      if (key > (float) remaining[node]) continue;
      if (remaining[node] > deadline + LATE_SLACK) break;
      for (var edge : graph.incomingEdges(node)) {
        if (!motion.allowed().test(edge)) continue;
        var source = graph.edgeSource(edge);
        var through = remaining[node] + motion.duration().applyAsDouble(edge);
        if (through < remaining[source]) {
          remaining[source] = through;
          open.push((float) through, source);
        }
      }
    }
    return remaining;
  }
}
