package com.shepherdjerred.thestorm.towns.domain.map;

import static java.util.Comparator.comparingInt;
import static java.util.Comparator.comparingLong;

import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * Turns a town's claimed chunks into map outlines: one polygon per edge-connected piece of land,
 * with its unclaimed pockets as holes, so the web map shows a town's borders rather than a grid.
 *
 * <p>Every chunk edge with no claimed chunk beyond it is a boundary edge, walked with the claimed
 * side on the right. Where two claimed chunks touch only at a corner the walk turns right, keeping
 * each chunk with its own piece. Outer rings wind one way and holes the other, which the signed
 * area tells apart.
 */
public final class ClaimOutlines {

  private static final int CHUNK = 16;

  private ClaimOutlines() {}

  /** The outlines of {@code chunks}, by world name. */
  public static Map<String, List<Outline>> of(Collection<ChunkPos> chunks) {
    var byWorld = new TreeMap<String, Set<Cell>>();
    for (var chunk : chunks) {
      byWorld
          .computeIfAbsent(chunk.world(), world -> new HashSet<>())
          .add(new Cell(chunk.x(), chunk.z()));
    }
    var outlines = new TreeMap<String, List<Outline>>();
    byWorld.forEach((world, cells) -> outlines.put(world, outlines(cells)));
    return outlines;
  }

  private record Cell(int x, int z) {}

  private record Point(int x, int z) {}

  private record Edge(Point from, Point to) {

    int dx() {
      return to.x() - from.x();
    }

    int dz() {
      return to.z() - from.z();
    }
  }

  private static List<Outline> outlines(Set<Cell> cells) {
    var outers = new ArrayList<List<Point>>();
    var holes = new ArrayList<List<Point>>();
    for (var loop : loops(boundary(cells))) {
      (area(loop) > 0 ? outers : holes).add(loop);
    }
    var holesOf = new HashMap<List<Point>, List<List<Point>>>();
    for (var hole : holes) {
      holesOf.computeIfAbsent(enclosing(hole, outers), outer -> new ArrayList<>()).add(hole);
    }
    return outers.stream()
        .map(
            outer ->
                new Outline(
                    blocks(outer),
                    holesOf.getOrDefault(outer, List.of()).stream()
                        .map(ClaimOutlines::blocks)
                        .toList()))
        .toList();
  }

  /** Every boundary edge, in a fixed order so outlines come out the same every time. */
  private static Set<Edge> boundary(Set<Cell> cells) {
    var sorted = cells.stream().sorted(comparingInt(Cell::z).thenComparingInt(Cell::x)).toList();
    var edges = new LinkedHashSet<Edge>();
    for (var cell : sorted) {
      int x = cell.x();
      int z = cell.z();
      if (!cells.contains(new Cell(x, z - 1))) {
        edges.add(new Edge(new Point(x, z), new Point(x + 1, z)));
      }
      if (!cells.contains(new Cell(x + 1, z))) {
        edges.add(new Edge(new Point(x + 1, z), new Point(x + 1, z + 1)));
      }
      if (!cells.contains(new Cell(x, z + 1))) {
        edges.add(new Edge(new Point(x + 1, z + 1), new Point(x, z + 1)));
      }
      if (!cells.contains(new Cell(x - 1, z))) {
        edges.add(new Edge(new Point(x, z + 1), new Point(x, z)));
      }
    }
    return edges;
  }

  private static List<List<Point>> loops(Set<Edge> edges) {
    var outgoing = new HashMap<Point, List<Edge>>();
    edges.forEach(
        edge -> outgoing.computeIfAbsent(edge.from(), point -> new ArrayList<>()).add(edge));
    var remaining = new LinkedHashSet<>(edges);
    var loops = new ArrayList<List<Point>>();
    while (!remaining.isEmpty()) {
      var start = remaining.iterator().next();
      remaining.remove(start);
      var walked = new ArrayList<Edge>();
      walked.add(start);
      var current = start;
      while (!current.to().equals(start.from())) {
        current = next(current, outgoing.getOrDefault(current.to(), List.of()), remaining);
        remaining.remove(current);
        walked.add(current);
      }
      loops.add(corners(walked));
    }
    return loops;
  }

  /** The edge after {@code arriving}: a right turn if there is one, else straight, else left. */
  private static Edge next(Edge arriving, List<Edge> candidates, Set<Edge> remaining) {
    var dx = arriving.dx();
    var dz = arriving.dz();
    var preferred = List.of(new Point(-dz, dx), new Point(dx, dz), new Point(dz, -dx));
    for (var direction : preferred) {
      for (var candidate : candidates) {
        if (remaining.contains(candidate)
            && candidate.dx() == direction.x()
            && candidate.dz() == direction.z()) {
          return candidate;
        }
      }
    }
    throw new IllegalStateException("a claim boundary does not close at " + arriving.to());
  }

  /** The loop's corners: where its direction changes. */
  private static List<Point> corners(List<Edge> walked) {
    var corners = new ArrayList<Point>();
    for (var i = 0; i < walked.size(); i++) {
      var before = walked.get((i + walked.size() - 1) % walked.size());
      var edge = walked.get(i);
      if (before.dx() != edge.dx() || before.dz() != edge.dz()) {
        corners.add(edge.from());
      }
    }
    return corners;
  }

  /** Twice the loop's signed area: positive for outer rings, negative for holes. */
  private static long area(List<Point> loop) {
    var sum = 0L;
    for (var i = 0; i < loop.size(); i++) {
      var a = loop.get(i);
      var b = loop.get((i + 1) % loop.size());
      sum += (long) a.x() * b.z() - (long) b.x() * a.z();
    }
    return sum;
  }

  /** The smallest outer ring around {@code hole}. */
  private static List<Point> enclosing(List<Point> hole, List<List<Point>> outers) {
    var a = hole.get(0);
    var b = hole.get(1);
    // The middle of the unclaimed chunk just left of the hole's first edge.
    var dx = Integer.signum(b.x() - a.x());
    var dz = Integer.signum(b.z() - a.z());
    var x = a.x() + dx * 0.5 + dz * 0.5;
    var z = a.z() + dz * 0.5 - dx * 0.5;
    return outers.stream()
        .filter(outer -> contains(outer, x, z))
        .min(comparingLong(ClaimOutlines::area))
        .orElseThrow(() -> new IllegalStateException("a hole outside every outline: " + hole));
  }

  /** Ray casting; the point is always a chunk's centre, so it never lies on an edge. */
  private static boolean contains(List<Point> ring, double x, double z) {
    var inside = false;
    for (var i = 0; i < ring.size(); i++) {
      var a = ring.get(i);
      var b = ring.get((i + 1) % ring.size());
      if ((a.z() > z) != (b.z() > z)) {
        var crossing = a.x() + (z - a.z()) * (b.x() - a.x()) / (double) (b.z() - a.z());
        if (x < crossing) {
          inside = !inside;
        }
      }
    }
    return inside;
  }

  private static List<Outline.Corner> blocks(List<Point> loop) {
    return loop.stream()
        .map(point -> new Outline.Corner(point.x() * CHUNK, point.z() * CHUNK))
        .toList();
  }
}
