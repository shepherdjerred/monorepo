package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * One way from a team's home to its objective: the nav nodes in order, their feet positions, and
 * the corridor of nodes within a couple of steps of it that a bot routing along the lane may use
 * freely.
 *
 * @param nodes the nav nodes, home first
 * @param points each node's feet position
 * @param corridor the lane's nodes and their near neighbours
 * @param lateral the lane's widest sideways offset from the straight line home to objective, in
 *     blocks, signed; lanes are ordered by it
 */
public record Lane(List<Integer> nodes, List<Vec3> points, Set<Integer> corridor, double lateral) {

  public Lane {
    nodes = List.copyOf(nodes);
    points = List.copyOf(points);
    corridor = Set.copyOf(corridor);
    if (nodes.isEmpty() || nodes.size() != points.size()) {
      throw new IllegalArgumentException("a lane needs one point per node");
    }
    if (!corridor.containsAll(nodes)) {
      throw new IllegalArgumentException("a lane's corridor contains the lane");
    }
    if (!Double.isFinite(lateral)) {
      throw new IllegalArgumentException("lateral offset must be finite");
    }
  }

  /** The walked length of the lane. */
  public double length() {
    var total = 0.0;
    for (var i = 1; i < points.size(); i++) {
      total += points.get(i - 1).distance(points.get(i));
    }
    return total;
  }

  /** The point {@code progress} (0 at home, 1 at the objective) of the way along the lane. */
  public Vec3 at(double progress) {
    var target = Math.clamp(progress, 0, 1) * length();
    var walked = 0.0;
    for (var i = 1; i < points.size(); i++) {
      var from = points.get(i - 1);
      var to = points.get(i);
      var step = from.distance(to);
      if (walked + step >= target && step > 0) {
        return from.lerp(to, (target - walked) / step);
      }
      walked += step;
    }
    return points.getLast();
  }

  /** How far along the lane the point nearest {@code pos} lies, 0..1. */
  public double progressOf(Vec3 pos) {
    var length = length();
    if (length == 0) {
      return 1;
    }
    var best = Double.POSITIVE_INFINITY;
    var bestWalked = 0.0;
    var walked = 0.0;
    for (var i = 0; i < points.size(); i++) {
      if (i > 0) {
        walked += points.get(i - 1).distance(points.get(i));
      }
      var distance = points.get(i).horizontalDistance(pos);
      if (distance < best) {
        best = distance;
        bestWalked = walked;
      }
    }
    return bestWalked / length;
  }

  /** The points of the lane from {@code from} to {@code to} progress, for drawing. */
  public List<Vec3> between(double from, double to) {
    var out = new ArrayList<Vec3>();
    var steps = Math.max(1, (int) Math.ceil(Math.abs(to - from) * length()));
    for (var i = 0; i <= steps; i++) {
      out.add(at(from + (to - from) * i / steps));
    }
    return out;
  }
}
