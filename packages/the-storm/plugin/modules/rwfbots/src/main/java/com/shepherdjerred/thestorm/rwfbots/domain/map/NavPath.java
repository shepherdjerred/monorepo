package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.List;

/**
 * A path through the nav graph.
 *
 * @param nodes the nodes visited, start first
 * @param waypoints the same path as feet positions with how each is reached
 * @param cost the summed edge cost
 */
public record NavPath(List<Integer> nodes, List<Waypoint> waypoints, double cost) {

  public NavPath {
    nodes = List.copyOf(nodes);
    waypoints = List.copyOf(waypoints);
    if (nodes.size() != waypoints.size()) {
      throw new IllegalArgumentException("nodes and waypoints must align");
    }
    if (!(cost >= 0)) {
      throw new IllegalArgumentException("cost must be non-negative: " + cost);
    }
  }

  public int length() {
    return nodes.size();
  }

  /** The waypoints after the start node, which the walker is already standing on. */
  public List<Waypoint> toFollow() {
    return waypoints.size() <= 1 ? List.of() : waypoints.subList(1, waypoints.size());
  }
}
