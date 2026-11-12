package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.List;
import java.util.Optional;

/** A route that walks a long way and comes back, which a lone bot was retracing in a loop. */
public final class RouteLoops {

  /** A path at least this long, in blocks, can be a loop. */
  static final double LONG = 16;

  /** The end of a loop is this close to where it began, in blocks. */
  static final double NEAR = 4;

  private RouteLoops() {}

  /** Whether {@code points} travels a long way and finishes near its start. */
  public static boolean loops(List<Waypoint> points) {
    if (points.size() < 4) return false;
    var length = 0.0;
    var at = points.getFirst().pos();
    for (var index = 1; index < points.size(); index++) {
      var next = points.get(index).pos();
      length += at.horizontalDistance(next);
      at = next;
    }
    return length >= LONG
        && points.getLast().pos().horizontalDistance(points.getFirst().pos()) <= NEAR;
  }

  /** The direction of the first real step, when the route has one. */
  public static Optional<Vec3> opening(List<Waypoint> points) {
    if (points.size() < 2) return Optional.empty();
    var step = points.get(1).pos().minus(points.getFirst().pos()).horizontal();
    if (step.length() < 0.2) return Optional.empty();
    return Optional.of(step.normalized());
  }
}
