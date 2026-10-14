package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.List;
import java.util.Optional;

/** Reaching a goal and failing to find a route must never produce the same navigation result. */
public sealed interface RouteResult {
  record Arrived() implements RouteResult {}

  record Path(List<Waypoint> points) implements RouteResult {
    public Path {
      points = List.copyOf(points);
      if (points.isEmpty()) throw new IllegalArgumentException("a path needs a waypoint");
    }
  }

  enum Problem {
    START_OUTSIDE_NAVIGATION,
    GOAL_OUTSIDE_NAVIGATION,
    DISCONNECTED
  }

  record Unreachable(Vec3 goal, Problem problem) implements RouteResult {}

  default List<Waypoint> waypoints() {
    return this instanceof Path path ? path.points() : List.of();
  }

  default Optional<Unreachable> failure() {
    return this instanceof Unreachable unreachable ? Optional.of(unreachable) : Optional.empty();
  }
}
