package com.shepherdjerred.thestorm.rwfbots.domain.map;

import java.util.BitSet;

/** Immutable directed reachability owned by one graph, with bounded transitive-closure storage. */
final class DirectedReachability {
  /** Larger condensations use an exact workspace traversal instead of quadratic storage. */
  private static final long MAX_CLOSURE_BYTES = 8L * 1024 * 1024;

  private final int[] component;
  private final BitSet[] closure;
  private final Condensation dag;

  DirectedReachability(NavGraph graph) {
    var groups = StrongComponents.of(graph);
    component = groups.components();
    var condensed = Condensation.of(graph, component, groups.count());
    var bytes = groups.count() * ((groups.count() + 63L) / 64) * Long.BYTES;
    closure = bytes <= MAX_CLOSURE_BYTES ? condensed.closure() : new BitSet[0];
    dag = closure.length == 0 ? condensed : new Condensation(new int[0], new int[0]);
  }

  int componentOf(int node) {
    return component[node];
  }

  /**
   * The returned bits are read-only to the caller; scratch is borrowed only for a DAG traversal.
   */
  BitSet from(int node, BitSet scratch, int[] stack) {
    var source = component[node];
    if (closure.length > 0) return closure[source];
    scratch.clear();
    scratch.set(source);
    var pending = 0;
    stack[pending++] = source;
    while (pending > 0) {
      var current = stack[--pending];
      for (var edge = dag.start[current]; edge < dag.start[current + 1]; edge++) {
        var next = dag.to[edge];
        if (!scratch.get(next)) {
          scratch.set(next);
          stack[pending++] = next;
        }
      }
    }
    return scratch;
  }

  private static final class Condensation {
    private final int[] start;
    private final int[] to;

    private Condensation(int[] start, int[] to) {
      this.start = start;
      this.to = to;
    }

    static Condensation of(NavGraph graph, int[] component, int count) {
      var start = new int[count + 1];
      for (var node = 0; node < graph.nodeCount(); node++) {
        for (var edge = graph.edgeStart(node); edge < graph.edgeEnd(node); edge++) {
          if (component[node] != component[graph.edgeTarget(edge)]) start[component[node] + 1]++;
        }
      }
      for (var group = 0; group < count; group++) start[group + 1] += start[group];
      var to = new int[start[count]];
      var fill = start.clone();
      for (var node = 0; node < graph.nodeCount(); node++) {
        for (var edge = graph.edgeStart(node); edge < graph.edgeEnd(node); edge++) {
          var target = component[graph.edgeTarget(edge)];
          if (component[node] != target) to[fill[component[node]]++] = target;
        }
      }
      return new Condensation(start, to);
    }

    BitSet[] closure() {
      var count = start.length - 1;
      var result = new BitSet[count];
      for (var group = 0; group < count; group++) {
        var reachable = new BitSet(count);
        reachable.set(group);
        for (var edge = start[group]; edge < start[group + 1]; edge++) {
          if (to[edge] >= group)
            throw new IllegalStateException("component order is not topological");
          reachable.or(result[to[edge]]);
        }
        result[group] = reachable;
      }
      return result;
    }
  }
}
