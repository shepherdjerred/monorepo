package com.shepherdjerred.thestorm.rwfbots.domain.map;

import java.util.HashMap;
import java.util.Map;
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

  /** Query-local bounded reuse; a full cache changes computation frequency, never route costs. */
  public static IntToDoubleFunction memoized(IntToDoubleFunction density) {
    return density instanceof Cached ? density : new Cached(density);
  }

  private static final class Cached implements IntToDoubleFunction {
    private static final int LIMIT = 4096;
    private final IntToDoubleFunction density;
    private final Map<Integer, Double> values = new HashMap<>();

    Cached(IntToDoubleFunction density) {
      this.density = density;
    }

    @Override
    public double applyAsDouble(int node) {
      var known = values.get(node);
      if (known != null) return known;
      var value = density.applyAsDouble(node);
      if (values.size() < LIMIT) values.put(node, value);
      return value;
    }
  }
}
