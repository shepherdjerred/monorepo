package com.shepherdjerred.thestorm.creative.domain;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;

/**
 * Plots merged by an owner. The road between them stays in the world. Builders and WorldEdit may
 * use the merged footprints plus that road, and nowhere else.
 */
public final class PlotMerge {

  private PlotMerge() {}

  /** One column, used when a piston or explosion crosses a plot edge. */
  public record Column(int x, int z) {}

  /** Whether the two plots share a side. A diagonal pair does not. */
  public static boolean orthogonal(PlotId left, PlotId right) {
    int dx = Math.abs(left.x() - right.x());
    int dz = Math.abs(left.z() - right.z());
    return (dx == 1 && dz == 0) || (dx == 0 && dz == 1);
  }

  /** The plot id every merged row stores. The smallest {@code x}, then {@code z}, wins. */
  public static PlotId anchor(Collection<PlotId> ids) {
    PlotId best = null;
    for (var id : ids) {
      if (best == null || before(id, best)) {
        best = id;
      }
    }
    if (best == null) {
      throw new IllegalArgumentException("a merge needs a plot");
    }
    return best;
  }

  /** Whether any plot in {@code left} shares a side with any plot in {@code right}. */
  public static boolean touches(Collection<PlotId> left, Collection<PlotId> right) {
    for (var a : left) {
      for (var b : right) {
        if (orthogonal(a, b)) {
          return true;
        }
      }
    }
    return false;
  }

  /** The road rectangle between two plots that share a side. */
  public static PlotArea road(PlotGrid grid, PlotId left, PlotId right) {
    if (!orthogonal(left, right)) {
      throw new IllegalArgumentException("plots do not share a road");
    }
    var a = grid.bounds(left);
    var b = grid.bounds(right);
    if (left.x() != right.x()) {
      int minX = Math.min(a.maxX(), b.maxX()) + 1;
      int maxX = Math.max(a.minX(), b.minX()) - 1;
      return new PlotArea(minX, maxX, a.minZ(), a.maxZ());
    }
    int minZ = Math.min(a.maxZ(), b.maxZ()) + 1;
    int maxZ = Math.max(a.minZ(), b.minZ()) - 1;
    return new PlotArea(a.minX(), a.maxX(), minZ, maxZ);
  }

  /** Each plot footprint, then each road between plots that share a side. */
  public static List<PlotArea> areas(PlotGrid grid, Collection<PlotId> members) {
    var areas = new ArrayList<PlotArea>();
    var ids = List.copyOf(members);
    for (var id : ids) {
      areas.add(PlotArea.of(grid.bounds(id)));
    }
    areas.addAll(roads(grid, ids));
    return List.copyOf(areas);
  }

  /** Roads between orthogonally adjacent members. Diagonal gaps are not included. */
  public static List<PlotArea> roads(PlotGrid grid, Collection<PlotId> members) {
    var roads = new ArrayList<PlotArea>();
    var ids = List.copyOf(members);
    for (int i = 0; i < ids.size(); i++) {
      for (int j = i + 1; j < ids.size(); j++) {
        if (orthogonal(ids.get(i), ids.get(j))) {
          roads.add(road(grid, ids.get(i), ids.get(j)));
        }
      }
    }
    return List.copyOf(roads);
  }

  /** Whether {@code (x, z)} sits in any of {@code areas}. */
  public static boolean covers(List<PlotArea> areas, int x, int z) {
    for (var area : areas) {
      if (area.contains(x, z)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Whether {@code selection} stays inside the union and is no taller than the world. The volume
   * cap is the sum of the areas, so a bounding box that fills an outside corner is refused.
   */
  public static boolean selectionFits(
      List<PlotArea> areas, BlockBox selection, int worldMinY, int worldMaxY) {
    if (areas.isEmpty() || selection.minY() < worldMinY || selection.maxY() > worldMaxY) {
      return false;
    }
    long cap = 0;
    for (var area : areas) {
      cap += area.columnVolume(worldMinY, worldMaxY);
    }
    if (selection.volume() > cap) {
      return false;
    }
    return coversBox(areas, selection);
  }

  /**
   * Whether every column is one editable group. A normal road, or two plots that are not merged,
   * refuses the whole piston, fluid, or explosion.
   */
  public static boolean contained(
      PlotGrid grid, List<Column> columns, List<List<PlotId>> clusters) {
    if (columns.isEmpty()) {
      return true;
    }
    List<PlotId> chosen = null;
    for (var column : columns) {
      var group = clusterAt(grid, column, clusters);
      if (group.isEmpty()) {
        return false;
      }
      if (chosen == null) {
        chosen = group;
      } else if (!same(chosen, group)) {
        return false;
      }
    }
    return true;
  }

  /**
   * The merged plots that contain this column, or the single plot under it. Empty on a road that is
   * not between merged plots.
   */
  public static List<PlotId> clusterAt(PlotGrid grid, Column column, List<List<PlotId>> clusters) {
    var plot = grid.plotAt(column.x(), column.z());
    if (plot.isPresent()) {
      return groupOf(plot.orElseThrow(), clusters);
    }
    for (var cluster : clusters) {
      if (roadContains(grid, cluster, column)) {
        return cluster;
      }
    }
    return List.of();
  }

  /** Whether {@code actor} may build on a road that sits between plots they can build on. */
  public static boolean buildsOnRoad(
      PlotGrid grid, Column at, UUID actor, PlotMembership membership) {
    for (var cluster : membership.clusters()) {
      if (roadContains(grid, cluster, at)
          && EditDecision.mayEdit(
              actor, membership.owner(cluster.getFirst()), membership.access(cluster.getFirst()))) {
        return true;
      }
    }
    return false;
  }

  /** Whether this road column belongs to {@code cluster}. */
  public static boolean roadContains(PlotGrid grid, List<PlotId> cluster, Column at) {
    for (var road : roads(grid, cluster)) {
      if (road.contains(at.x(), at.z())) {
        return true;
      }
    }
    return false;
  }

  private static boolean coversBox(List<PlotArea> areas, BlockBox selection) {
    for (int x = selection.minX(); x <= selection.maxX(); x++) {
      for (int z = selection.minZ(); z <= selection.maxZ(); z++) {
        if (!covers(areas, x, z)) {
          return false;
        }
      }
    }
    return true;
  }

  private static List<PlotId> groupOf(PlotId id, List<List<PlotId>> clusters) {
    for (var cluster : clusters) {
      if (cluster.contains(id)) {
        return cluster;
      }
    }
    return List.of(id);
  }

  private static boolean same(List<PlotId> left, List<PlotId> right) {
    return left.size() == right.size() && new HashSet<>(left).containsAll(right);
  }

  private static boolean before(PlotId id, PlotId best) {
    return id.x() < best.x() || (id.x() == best.x() && id.z() < best.z());
  }
}
