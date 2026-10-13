package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementMotor;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.PriorityQueue;
import java.util.function.ToDoubleFunction;

/**
 * Depth-aware query expansion over compressed fluid intervals, including virtual start/end depths.
 */
public final class WaterRoutes {
  private static final double[] CAPSULE_OFFSETS = {-0.299, 0.299};

  private WaterRoutes() {}

  public record Endpoints(Vec3 from, Vec3 to) {}

  public record Route(List<Waypoint> waypoints, double ticks, double weightedCost) {
    public Route {
      waypoints = List.copyOf(waypoints);
    }
  }

  public static Optional<Route> find(
      WaterIndex water, VoxelGrid grid, Endpoints endpoints, ToDoubleFunction<Vec3> penalty) {
    if (!water.bounds().equals(grid.bounds()))
      throw new IllegalArgumentException("water route collision bounds differ");
    var source = water.at(BlockPos.of(endpoints.from()));
    var goal = water.at(BlockPos.of(endpoints.to()));
    if (source.isEmpty() || goal.isEmpty()) return Optional.empty();
    return new Search(water, grid, endpoints, penalty).find(source.orElseThrow().id());
  }

  private record State(int interval, double height) {}

  private record Prefix(Optional<Label> previous, List<Vec3> points) {}

  private record Weight(double ticks, double cost, double verticalTravel) {}

  private static final class Label {
    final State state;
    final Vec3 point;
    final Weight weight;
    final Prefix prefix;

    Label(State state, Vec3 point, Weight weight, Prefix prefix) {
      this.state = state;
      this.point = point;
      this.weight = weight;
      this.prefix = prefix;
    }
  }

  private static final class Search {
    private final WaterIndex water;
    private final Endpoints endpoints;
    private final VoxelGrid grid;
    private final ToDoubleFunction<Vec3> penalty;
    private final int goal;
    private final int[] criticalHeights;
    private final Map<State, Weight> best = new HashMap<>();
    private final PriorityQueue<Label> open =
        new PriorityQueue<>(
            Comparator.comparingDouble(this::score)
                .thenComparingDouble(label -> label.weight.verticalTravel())
                .thenComparingInt(label -> label.state.interval())
                .thenComparingDouble(label -> label.state.height()));

    Search(WaterIndex water, VoxelGrid grid, Endpoints endpoints, ToDoubleFunction<Vec3> penalty) {
      this.water = water;
      this.grid = grid;
      this.endpoints = endpoints;
      this.penalty = penalty;
      this.goal = water.at(BlockPos.of(endpoints.to())).orElseThrow().id();
      criticalHeights = water.criticalHeights();
    }

    Optional<Route> find(int source) {
      offer(
          new Label(
              new State(source, endpoints.from().y()),
              endpoints.from(),
              new Weight(0, 0, 0),
              new Prefix(Optional.empty(), List.of())));
      while (!open.isEmpty()) {
        var current = open.remove();
        var known = requireNonNull(best.get(current.state), "queued water state has no cost");
        if (better(known, current.weight)) continue;
        if (current.state.interval() == -1) return Optional.of(reconstruct(current));
        finish(current);
        for (var neighbor : water.neighbors(current.state.interval())) expand(current, neighbor);
      }
      return Optional.empty();
    }

    private double score(Label label) {
      return label.weight.cost() + time(label.point, endpoints.to());
    }

    private void finish(Label current) {
      if (current.state.interval() == goal && clear(current.point, endpoints.to()))
        advance(current, new State(-1, endpoints.to().y()), List.of(endpoints.to()));
    }

    private void expand(Label current, WaterIndex.ColumnInterval neighbor) {
      var own = water.volume(current.state.interval());
      var low = Math.max(own.low().y(), neighbor.low().y());
      var high = Math.nextDown((double) Math.min(own.high(), neighbor.high()) + 1);
      double[] heights = {
        Math.clamp(current.point.y(), low, high),
        Math.clamp(endpoints.to().y(), low, high),
        low,
        high
      };
      for (var height : heights) transition(current, neighbor, height);
      for (var height : criticalHeights)
        if (height > low && height < high) transition(current, neighbor, height);
    }

    private void transition(Label current, WaterIndex.ColumnInterval neighbor, double height) {
      var next = new Vec3(neighbor.low().x() + 0.5, height, neighbor.low().z() + 0.5);
      var state = new State(neighbor.id(), height);
      var known = best.get(state);
      if (known != null && known.cost() < current.weight.cost() + time(current.point, next)) return;
      if (clear(current.point, next)) {
        advance(current, state, List.of(next));
        return;
      }
      var vertical = new Vec3(current.point.x(), height, current.point.z());
      if (clear(current.point, vertical) && clear(vertical, next))
        advance(current, state, List.of(vertical, next));
    }

    private void advance(Label current, State state, List<Vec3> points) {
      var ticks = current.weight.ticks();
      var cost = current.weight.cost();
      var vertical = current.weight.verticalTravel();
      var previous = current.point;
      for (var point : points) {
        var duration = time(previous, point);
        if (duration == 0) continue;
        var extra = penalty.applyAsDouble(point);
        if (!Double.isFinite(extra) || extra < 0)
          throw new IllegalArgumentException("water route penalty must be finite and non-negative");
        ticks += duration;
        cost += duration + extra;
        vertical += Math.abs(point.y() - previous.y());
        previous = point;
      }
      offer(
          new Label(
              state,
              points.getLast(),
              new Weight(ticks, cost, vertical),
              new Prefix(Optional.of(current), points)));
    }

    private void offer(Label label) {
      var known = best.get(label.state);
      if (known != null && !better(label.weight, known)) return;
      best.put(label.state, label.weight);
      open.add(label);
    }

    private boolean better(Weight left, Weight right) {
      return left.cost() < right.cost()
          || (left.cost() == right.cost() && left.verticalTravel() < right.verticalTravel());
    }

    private boolean clear(Vec3 from, Vec3 to) {
      var divisions = Math.max(1, (int) Math.ceil(from.distance(to) / 0.2));
      for (var step = 0; step <= divisions; step++) {
        var point = from.plus(to.minus(from).scale((double) step / divisions));
        if (!occupied(point)) return false;
      }
      return true;
    }

    private boolean occupied(Vec3 point) {
      if (!clearCapsule(point)) return false;
      for (var dx : CAPSULE_OFFSETS) {
        for (var dz : CAPSULE_OFFSETS) {
          var interval = water.at(BlockPos.of(point.plus(dx, 0, dz)));
          if (interval.isEmpty()) return false;
        }
      }
      return true;
    }

    private boolean clearCapsule(Vec3 point) {
      var min = BlockPos.of(point.plus(-0.299, 0.001, -0.299));
      var max = BlockPos.of(point.plus(0.299, 1.799, 0.299));
      for (var x = min.x(); x <= max.x(); x++)
        for (var y = min.y(); y <= max.y(); y++)
          for (var z = min.z(); z <= max.z(); z++)
            if (grid.blocksMovement(new BlockPos(x, y, z))) return false;
      return true;
    }

    private Route reconstruct(Label goal) {
      var chunks = new ArrayList<List<Vec3>>();
      var current = goal;
      while (current.prefix.previous().isPresent()) {
        chunks.add(current.prefix.points());
        current = current.prefix.previous().orElseThrow();
      }
      Collections.reverse(chunks);
      var points =
          chunks.stream()
              .flatMap(List::stream)
              .map(point -> new Waypoint(point, Hop.SWIM))
              .toList();
      return new Route(points, goal.weight.ticks(), goal.weight.cost());
    }
  }

  private static double time(Vec3 from, Vec3 to) {
    return Math.max(
        from.horizontalDistance(to) / MovementMotor.WALK_SPEED,
        Math.abs(from.y() - to.y()) * TraversalCosts.SWIM_VERTICAL);
  }
}
