package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.BitSet;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.IntPredicate;
import java.util.function.Supplier;

/**
 * The nodes of one graph from which a fixed set of targets can be reached, over every edge or over
 * every edge but a sprint jump, found once per target set and kept for the graph's life.
 */
final class AnchorReach {
  private final NavGraph graph;
  private final ConcurrentHashMap<Reach, BitSet> reaching = new ConcurrentHashMap<>();

  AnchorReach(NavGraph graph) {
    this.graph = graph;
  }

  private record Reach(Object key, boolean leaps) {}

  /** Whether each node reaches one of {@code targets}, found once per {@code key}. */
  IntPredicate reaching(Object key, Supplier<int[]> targets, boolean leaps) {
    var set =
        reaching.computeIfAbsent(new Reach(key, leaps), reach -> reachingSet(targets.get(), leaps));
    return set::get;
  }

  /** Backwards from the targets over incoming edges, skipping sprint jumps unless they count. */
  private BitSet reachingSet(int[] targets, boolean leaps) {
    var seen = targets(targets);
    var stack = new int[graph.nodeCount()];
    var pending = 0;
    for (var target = seen.nextSetBit(0); target >= 0; target = seen.nextSetBit(target + 1))
      stack[pending++] = target;
    if (targets.length == 0) pending = 0;
    while (pending > 0) {
      var node = stack[--pending];
      for (var edge : graph.incomingEdges(node)) {
        if (!leaps && graph.edgeHop(edge) == Hop.LEAP) continue;
        var source = graph.edgeSource(edge);
        if (!seen.get(source)) {
          seen.set(source);
          stack[pending++] = source;
        }
      }
    }
    return seen;
  }

  /** The target nodes; without any, every node, since there is nothing to be cut off from. */
  private BitSet targets(int[] targets) {
    var count = graph.nodeCount();
    var seen = new BitSet(count);
    if (targets.length == 0) seen.set(0, count);
    for (var target : targets) {
      if (target < 0 || target >= count) throw new IllegalArgumentException("invalid target node");
      seen.set(target);
    }
    return seen;
  }
}
