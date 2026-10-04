package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * For every node, the next step towards the nearest goal and the cost of getting there. Built once
 * by Dijkstra over the reversed graph, then answering a step is an array read, so many bots can
 * head for the same place without each running A*.
 */
public final class FlowField {

  private final NavGraph graph;
  private final DistanceField distance;
  private final int[] next;

  private FlowField(NavGraph graph, DistanceField distance, int[] next) {
    this.graph = graph;
    this.distance = distance;
    this.next = next;
  }

  /** The field towards {@code goals}, each a node of {@code graph}. */
  public static FlowField toward(NavGraph graph, int... goals) {
    if (goals.length == 0) {
      throw new IllegalArgumentException("a flow field needs at least one goal");
    }
    var n = graph.nodeCount();
    var dist = new float[n];
    Arrays.fill(dist, Float.POSITIVE_INFINITY);
    var next = new int[n];
    Arrays.fill(next, -1);
    var heap = new MinHeap(64);
    for (var goal : goals) {
      dist[goal] = 0;
      heap.push(0, goal);
    }
    var settled = new boolean[n];
    while (!heap.isEmpty()) {
      var key = heap.peekKey();
      var node = heap.pop();
      if (settled[node] || key > dist[node]) {
        continue;
      }
      settled[node] = true;
      for (var edge : graph.incomingEdges(node)) {
        var source = graph.edgeSource(edge);
        var tentative = dist[node] + graph.edgeCost(edge);
        if (tentative < dist[source]) {
          dist[source] = tentative;
          next[source] = node;
          heap.push(tentative, source);
        }
      }
    }
    return new FlowField(graph, new DistanceField(dist), next);
  }

  public DistanceField distance() {
    return distance;
  }

  /** The next node towards the goal from {@code node}, or -1 at a goal or where unreachable. */
  public int next(int node) {
    return next[node];
  }

  public boolean reachable(int node) {
    return distance.reachable(node);
  }

  /** Up to {@code maxSteps} waypoints from {@code node} towards the goal. */
  public List<Waypoint> pathFrom(int node, int maxSteps) {
    var out = new ArrayList<Waypoint>();
    var current = node;
    while (out.size() < maxSteps && next[current] >= 0) {
      var following = next[current];
      out.add(new Waypoint(graph.feet(following), hopBetween(current, following)));
      current = following;
    }
    return out;
  }

  private Hop hopBetween(int from, int to) {
    for (var edge = graph.edgeStart(from); edge < graph.edgeEnd(from); edge++) {
      if (graph.edgeTarget(edge) == to) {
        return graph.edgeHop(edge);
      }
    }
    throw new IllegalStateException("flow field step is not an edge: " + from + " -> " + to);
  }
}
