package com.shepherdjerred.thestorm.rwfbots.domain.map;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Up to three distinct paths from every spawn to every bomb. Alternatives are found by penalising
 * the nodes earlier routes used, so they spread across the map's lanes.
 *
 * @param routes every route
 */
public record ApproachRoutes(List<Route> routes) {

  public static final int ALTERNATIVES = 3;

  /** How much reusing a node from an earlier route costs when looking for an alternative. */
  static final double REUSE_PENALTY = 2.0;

  /**
   * One route.
   *
   * @param from the spawn site name
   * @param to the bomb site name
   * @param nodes the nodes in order
   * @param length the summed edge cost
   */
  public record Route(String from, String to, List<Integer> nodes, double length) {

    public Route {
      nodes = List.copyOf(nodes);
      if (from.isBlank() || to.isBlank() || nodes.isEmpty() || !(length >= 0)) {
        throw new IllegalArgumentException("bad route");
      }
    }
  }

  public ApproachRoutes {
    routes = List.copyOf(routes);
  }

  /** Routes from every spawn to every bomb of {@code sites} through {@code graph}. */
  public static ApproachRoutes build(NavGraph graph, NavSites sites) {
    var routes = new ArrayList<Route>();
    for (var spawn : sites.spawns()) {
      for (var bomb : sites.bombs()) {
        var from = graph.nearestNode(spawn.cell().feet());
        var to = graph.nearestNode(bomb.cell().feet());
        if (from.isEmpty() || to.isEmpty()) {
          continue;
        }
        routes.addAll(alternatives(graph, new Leg(spawn, bomb, from.getAsInt(), to.getAsInt())));
      }
    }
    return new ApproachRoutes(routes);
  }

  private record Leg(NavSites.Site spawn, NavSites.Site bomb, int from, int to) {}

  private static List<Route> alternatives(NavGraph graph, Leg leg) {
    var found = new ArrayList<Route>();
    var used = new HashSet<Integer>();
    for (var i = 0; i < ALTERNATIVES; i++) {
      var path = graph.path(leg.from(), leg.to(), node -> used.contains(node) ? REUSE_PENALTY : 0);
      if (path.isEmpty()) {
        break;
      }
      var nodes = path.get().nodes();
      if (found.stream().anyMatch(route -> route.nodes().equals(nodes))) {
        break;
      }
      found.add(new Route(leg.spawn().name(), leg.bomb().name(), nodes, trueLength(graph, nodes)));
      used.addAll(nodes);
    }
    return found;
  }

  private static double trueLength(NavGraph graph, List<Integer> nodes) {
    var length = 0.0;
    for (var i = 1; i < nodes.size(); i++) {
      var from = nodes.get(i - 1);
      var to = nodes.get(i);
      for (var edge = graph.edgeStart(from); edge < graph.edgeEnd(from); edge++) {
        if (graph.edgeTarget(edge) == to) {
          length += graph.edgeCost(edge);
          break;
        }
      }
    }
    return length;
  }

  public List<Route> between(String from, String to) {
    return routes.stream()
        .filter(route -> route.from().equals(from) && route.to().equals(to))
        .toList();
  }

  /** Every node any route crosses. */
  public Set<Integer> nodesUsed() {
    var out = new HashSet<Integer>();
    for (var route : routes) {
      out.addAll(route.nodes());
    }
    return out;
  }
}
