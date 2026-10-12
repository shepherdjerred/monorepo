package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static java.util.Comparator.comparingDouble;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Narrow passages: clusters of walkable cells where one horizontal axis is boxed in to three cells
 * or fewer while the other runs on. Ranked by the share of approach routes that pass through.
 *
 * @param points every chokepoint, busiest first
 */
public record Chokepoints(List<Chokepoint> points) {

  /** The widest passage still called a chokepoint. */
  static final int MAX_WIDTH = 3;

  /** The shortest run along the open axis for a passage to count, in cells. */
  static final int MIN_RUN = 5;

  private static final int SCAN = 6;

  /**
   * One chokepoint.
   *
   * @param node a node in the middle of the passage
   * @param width how many cells wide the passage is
   * @param routeShare the fraction of approach routes crossing it, 0..1
   * @param alongX whether the passage runs along x (walls on the z sides)
   */
  public record Chokepoint(int node, int width, double routeShare, boolean alongX) {

    public Chokepoint {
      if (node < 0 || width < 1 || !(routeShare >= 0 && routeShare <= 1)) {
        throw new IllegalArgumentException("bad chokepoint");
      }
    }
  }

  public Chokepoints {
    points = List.copyOf(points);
  }

  /** Finds the passages of {@code graph} in {@code grid} and ranks them by {@code routes}. */
  public static Chokepoints build(NavGraph graph, VoxelGrid grid, ApproachRoutes routes) {
    var n = graph.nodeCount();
    var narrowness = new Narrowness(new boolean[n], new boolean[n]);
    for (var node = 0; node < n; node++) {
      var cell = graph.cell(node);
      var widthX = run(grid, cell, 1, 0) + run(grid, cell, -1, 0) + 1;
      var widthZ = run(grid, cell, 0, 1) + run(grid, cell, 0, -1) + 1;
      if (widthZ <= MAX_WIDTH && widthX >= MIN_RUN) {
        narrowness.narrow()[node] = true;
        narrowness.alongX()[node] = true;
      } else if (widthX <= MAX_WIDTH && widthZ >= MIN_RUN) {
        narrowness.narrow()[node] = true;
      }
    }
    var points = new ArrayList<Chokepoint>();
    var seen = new boolean[n];
    for (var seed = 0; seed < n; seed++) {
      if (!narrowness.narrow()[seed] || seen[seed]) {
        continue;
      }
      var cluster = flood(graph, narrowness, seed, seen);
      points.add(describe(graph, cluster, narrowness.alongX()[seed], routes));
    }
    points.sort(comparingDouble(Chokepoint::routeShare).reversed());
    return new Chokepoints(points);
  }

  /** Which nodes are narrow and along which axis the passage runs. */
  private static final class Narrowness {
    private final boolean[] narrow;
    private final boolean[] alongX;

    Narrowness(boolean[] narrow, boolean[] alongX) {
      this.narrow = narrow;
      this.alongX = alongX;
    }

    boolean[] narrow() {
      return narrow;
    }

    boolean[] alongX() {
      return alongX;
    }
  }

  /** How many open cells lie in direction (dx, dz) before a wall at body height, capped. */
  private static int run(VoxelGrid grid, BlockPos cell, int dx, int dz) {
    for (var i = 1; i <= SCAN; i++) {
      var probe = cell.offset(dx * i, 0, dz * i);
      if (grid.blocksMovement(probe) || grid.blocksMovement(probe.up())) {
        return i - 1;
      }
    }
    return SCAN;
  }

  private static List<Integer> flood(
      NavGraph graph, Narrowness narrowness, int seed, boolean[] seen) {
    var narrow = narrowness.narrow();
    var alongX = narrowness.alongX();
    var cluster = new ArrayList<Integer>();
    var queue = new ArrayDeque<Integer>();
    queue.add(seed);
    seen[seed] = true;
    while (!queue.isEmpty()) {
      var node = queue.poll();
      cluster.add(node);
      for (var next : graph.neighbors(node)) {
        if (narrow[next] && !seen[next] && alongX[next] == alongX[seed]) {
          seen[next] = true;
          queue.add(next);
        }
      }
    }
    return cluster;
  }

  private static Chokepoint describe(
      NavGraph graph, List<Integer> cluster, boolean alongX, ApproachRoutes routes) {
    Set<Integer> members = new HashSet<>(cluster);
    var crossing = 0;
    for (var route : routes.routes()) {
      if (route.nodes().stream().anyMatch(members::contains)) {
        crossing++;
      }
    }
    var share = routes.routes().isEmpty() ? 0 : (double) crossing / routes.routes().size();
    var width = new HashSet<Integer>();
    for (var node : cluster) {
      var cell = graph.cell(node);
      width.add(alongX ? cell.z() : cell.x());
    }
    var middle = cluster.get(cluster.size() / 2);
    return new Chokepoint(middle, width.size(), share, alongX);
  }
}
