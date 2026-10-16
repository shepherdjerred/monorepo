package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static java.util.Objects.checkIndex;

import java.util.BitSet;
import java.util.function.IntToDoubleFunction;

/** Integrates discretionary density over physical time without changing arrival time or HP. */
public final class TraversalDensity {
  private TraversalDensity() {}

  public static double cost(double source, double target, double duration) {
    if (!Double.isFinite(source)
        || source < 0
        || !Double.isFinite(target)
        || target < 0
        || !Double.isFinite(duration)
        || duration < 0)
      throw new IllegalArgumentException(
          "density and physical duration must be finite and non-negative");
    return (source * 0.5 + target * 0.5) * (duration / TraversalCosts.WALK);
  }

  public static NavGraph.EdgeToll edges(NavGraph graph, IntToDoubleFunction density) {
    return (edge, source, duration) ->
        cost(
            density.applyAsDouble(source), density.applyAsDouble(graph.edgeTarget(edge)), duration);
  }

  /** Query-local reuse bounded by the graph; pages allocate only for visited node ids. */
  public static IntToDoubleFunction memoized(int nodeCount, IntToDoubleFunction density) {
    if (nodeCount < 0) throw new IllegalArgumentException("node count must be non-negative");
    if (density instanceof Cached cached) {
      if (cached.nodeCount != nodeCount)
        throw new IllegalArgumentException("density cache belongs to a different graph size");
      return cached;
    }
    return new Cached(nodeCount, density);
  }

  private static final class Cached implements IntToDoubleFunction {
    private static final int PAGE_SHIFT = 8;
    private static final int PAGE_SIZE = 1 << PAGE_SHIFT;
    private final int nodeCount;
    private final IntToDoubleFunction density;
    private final double[][] pages;
    private final BitSet computed = new BitSet();

    Cached(int nodeCount, IntToDoubleFunction density) {
      this.nodeCount = nodeCount;
      this.density = density;
      pages = new double[Math.ceilDiv(nodeCount, PAGE_SIZE)][];
    }

    @Override
    public double applyAsDouble(int node) {
      checkIndex(node, nodeCount);
      var page = node >>> PAGE_SHIFT;
      var offset = node & (PAGE_SIZE - 1);
      if (computed.get(node)) return pages[page][offset];
      var value = density.applyAsDouble(node);
      if (pages[page] == null)
        pages[page] = new double[Math.min(PAGE_SIZE, nodeCount - (page << PAGE_SHIFT))];
      pages[page][offset] = value;
      computed.set(node);
      return value;
    }
  }
}
