package com.shepherdjerred.thestorm.rwfbots.domain.map;

import java.util.Arrays;
import java.util.BitSet;

/** Iterative Tarjan traversal; component numbers run from sinks toward sources. */
final class StrongComponents {
  private final NavGraph graph;
  private final int[] index;
  private final int[] low;
  private final int[] nextEdge;
  private final int[] frames;
  private final int[] active;
  private final BitSet onStack;
  private final int[] component;
  private int visited;
  private int activeSize;
  private int count;

  private StrongComponents(NavGraph graph) {
    this.graph = graph;
    var size = graph.nodeCount();
    index = new int[size];
    Arrays.fill(index, -1);
    low = new int[size];
    nextEdge = new int[size];
    frames = new int[size];
    active = new int[size];
    onStack = new BitSet(size);
    component = new int[size];
  }

  /** The completed builder transfers its component labels to the reachability index. */
  static StrongComponents of(NavGraph graph) {
    var search = new StrongComponents(graph);
    for (var node = 0; node < graph.nodeCount(); node++) {
      if (search.index[node] < 0) search.visit(node);
    }
    return search;
  }

  int[] components() {
    return component.clone();
  }

  int count() {
    return count;
  }

  private void enter(int node) {
    index[node] = visited;
    low[node] = visited++;
    nextEdge[node] = graph.edgeStart(node);
    active[activeSize++] = node;
    onStack.set(node);
  }

  private void visit(int root) {
    var depth = 0;
    frames[depth] = root;
    enter(root);
    while (depth >= 0) {
      var node = frames[depth];
      if (nextEdge[node] < graph.edgeEnd(node)) {
        var next = graph.edgeTarget(nextEdge[node]++);
        if (index[next] < 0) {
          frames[++depth] = next;
          enter(next);
        } else if (onStack.get(next)) {
          low[node] = Math.min(low[node], index[next]);
        }
      } else {
        if (low[node] == index[node]) finishComponent(node);
        depth--;
        if (depth >= 0) {
          var parent = frames[depth];
          low[parent] = Math.min(low[parent], low[node]);
        }
      }
    }
  }

  private void finishComponent(int root) {
    int node;
    do {
      node = active[--activeSize];
      onStack.clear(node);
      component[node] = count;
    } while (node != root);
    count++;
  }
}
