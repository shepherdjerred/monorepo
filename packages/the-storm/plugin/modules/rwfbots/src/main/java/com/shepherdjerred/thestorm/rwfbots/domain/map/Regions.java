package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.BitSet;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Walkable nodes clustered into regions (connected cells inside 8 by 4 by 8 chunks) with a
 * region-to-region visibility table. Perception uses the table to skip ray casts between regions
 * that can never see each other; tactics uses it to find routes an enemy cannot watch.
 */
public final class Regions {

  /** How many nodes per region are sampled when deciding visibility. */
  static final int SAMPLES_PER_REGION = 6;

  private static final int CHUNK_XZ = 8;
  private static final int CHUNK_Y = 4;

  private final int[] regionOfNode;
  private final List<Vec3> centroids;
  private final BitSet visibility;

  /**
   * @param regionOfNode the region of each node
   * @param centroids the mean feet position of each region
   * @param visibility bit {@code a * count + b} set when region a can see region b
   */
  public Regions(int[] regionOfNode, List<Vec3> centroids, BitSet visibility) {
    this.regionOfNode = regionOfNode.clone();
    this.centroids = List.copyOf(centroids);
    this.visibility = (BitSet) visibility.clone();
    var count = this.centroids.size();
    for (var region : this.regionOfNode) {
      if (region < 0 || region >= count) {
        throw new IllegalArgumentException("node region out of range: " + region);
      }
    }
    if ((long) count * count > Integer.MAX_VALUE) {
      throw new IllegalArgumentException("too many regions for the visibility table: " + count);
    }
    if (this.visibility.length() > (long) count * count) {
      throw new IllegalArgumentException("visibility table larger than region count squared");
    }
  }

  /** Clusters {@code graph} and samples sight lines through {@code grid}. */
  public static Regions build(NavGraph graph, VoxelGrid grid) {
    var n = graph.nodeCount();
    var regionOfNode = new int[n];
    Arrays.fill(regionOfNode, -1);
    var members = new ArrayList<List<Integer>>();
    for (var seed = 0; seed < n; seed++) {
      if (regionOfNode[seed] < 0) {
        members.add(cluster(graph, regionOfNode, seed, members.size()));
      }
    }
    var centroids = new ArrayList<Vec3>(members.size());
    for (var nodes : members) {
      var sum = Vec3.ZERO;
      for (var node : nodes) {
        sum = sum.plus(graph.feet(node));
      }
      centroids.add(sum.scale(1.0 / nodes.size()));
    }
    var visibility = sampleVisibility(graph, grid, members);
    markNeighbours(graph, regionOfNode, members.size(), visibility);
    return new Regions(regionOfNode, centroids, visibility);
  }

  /**
   * Regions joined by an edge can always see each other across the join, however the samples fell;
   * this keeps doorways between chunks from being culled.
   */
  private static void markNeighbours(
      NavGraph graph, int[] regionOfNode, int count, BitSet visibility) {
    for (var node = 0; node < graph.nodeCount(); node++) {
      var a = regionOfNode[node];
      for (var edge = graph.edgeStart(node); edge < graph.edgeEnd(node); edge++) {
        var b = regionOfNode[graph.edgeTarget(edge)];
        if (a != b) {
          visibility.set(a * count + b);
          visibility.set(b * count + a);
        }
      }
    }
  }

  /** Labels every node connected to {@code seed} inside its chunk with {@code region}. */
  private static List<Integer> cluster(NavGraph graph, int[] regionOfNode, int seed, int region) {
    var origin = graph.bounds().origin();
    var found = new ArrayList<Integer>();
    var key = chunkKey(graph, seed, origin);
    var queue = new ArrayDeque<Integer>();
    queue.add(seed);
    regionOfNode[seed] = region;
    while (!queue.isEmpty()) {
      var node = queue.poll();
      found.add(node);
      for (var next : graph.neighbors(node)) {
        if (regionOfNode[next] < 0 && chunkKey(graph, next, origin) == key) {
          regionOfNode[next] = region;
          queue.add(next);
        }
      }
    }
    return found;
  }

  private static long chunkKey(
      NavGraph graph, int node, com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos origin) {
    var cell = graph.cell(node);
    long cx = ((long) cell.x() - origin.x()) / CHUNK_XZ;
    long cy = ((long) cell.y() - origin.y()) / CHUNK_Y;
    long cz = ((long) cell.z() - origin.z()) / CHUNK_XZ;
    return (cx << 42) | (cy << 21) | cz;
  }

  private static BitSet sampleVisibility(
      NavGraph graph, VoxelGrid grid, List<List<Integer>> members) {
    var count = members.size();
    var tableSize = Math.toIntExact((long) count * count);
    var eyes = new ArrayList<List<Vec3>>(count);
    for (var nodes : members) {
      var samples = new ArrayList<Vec3>();
      var stride = Math.max(1, nodes.size() / SAMPLES_PER_REGION);
      for (var i = 0; i < nodes.size() && samples.size() < SAMPLES_PER_REGION; i += stride) {
        samples.add(graph.feet(nodes.get(i)).plus(0, CombatantView.EYE_HEIGHT, 0));
      }
      eyes.add(samples);
    }
    var visibility = new BitSet(tableSize);
    for (var a = 0; a < count; a++) {
      visibility.set(a * count + a);
      for (var b = a + 1; b < count; b++) {
        if (anyClear(grid, eyes.get(a), eyes.get(b))) {
          visibility.set(a * count + b);
          visibility.set(b * count + a);
        }
      }
    }
    return visibility;
  }

  private static boolean anyClear(VoxelGrid grid, List<Vec3> from, List<Vec3> to) {
    for (var eye : from) {
      for (var other : to) {
        if (grid.canSee(eye, other)) {
          return true;
        }
      }
    }
    return false;
  }

  public int count() {
    return centroids.size();
  }

  public int nodeCount() {
    return regionOfNode.length;
  }

  public int regionOf(int node) {
    return regionOfNode[node];
  }

  public Vec3 centroid(int region) {
    return centroids.get(region);
  }

  /** Whether someone in region {@code a} might see someone in region {@code b}. */
  public boolean canSee(int a, int b) {
    return visibility.get(a * count() + b);
  }

  /** The fraction of {@code watchers} regions that can see {@code region}; 0 with no watchers. */
  public double exposure(int region, Collection<Integer> watchers) {
    if (watchers.isEmpty()) {
      return 0;
    }
    var seen = 0;
    for (var watcher : watchers) {
      if (canSee(watcher, region)) {
        seen++;
      }
    }
    return (double) seen / watchers.size();
  }

  /** How many regions can see each region, for ranking exposed ground. */
  public int[] watcherCounts() {
    var count = count();
    var out = new int[count];
    for (var a = 0; a < count; a++) {
      for (var b = 0; b < count; b++) {
        if (a != b && canSee(a, b)) {
          out[b]++;
        }
      }
    }
    return out;
  }

  int[] regionOfNodeArray() {
    return regionOfNode.clone();
  }

  List<Vec3> centroids() {
    return centroids;
  }

  BitSet visibility() {
    return (BitSet) visibility.clone();
  }

  @Override
  public boolean equals(Object other) {
    return other instanceof Regions that
        && Arrays.equals(regionOfNode, that.regionOfNode)
        && centroids.equals(that.centroids)
        && visibility.equals(that.visibility);
  }

  @Override
  public int hashCode() {
    return 31 * Arrays.hashCode(regionOfNode) + centroids.hashCode();
  }

  @Override
  public String toString() {
    return "Regions[" + count() + " regions over " + regionOfNode.length + " nodes]";
  }

  /** A map from region to its member nodes, rebuilt on demand. */
  public Map<Integer, List<Integer>> membersByRegion() {
    var out = new HashMap<Integer, List<Integer>>();
    for (var node = 0; node < regionOfNode.length; node++) {
      out.computeIfAbsent(regionOfNode[node], _ -> new ArrayList<>()).add(node);
    }
    return out;
  }
}
