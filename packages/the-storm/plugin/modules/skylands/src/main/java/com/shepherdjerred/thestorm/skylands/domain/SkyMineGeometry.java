package com.shepherdjerred.thestorm.skylands.domain;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** Timbers respect the union of every branch's passage; junctions never grow blocking posts. */
final class SkyMineGeometry {
  private final SkyCell cell;
  private final SkyEdits edits;
  private final Set<SkyPosition> centers = new LinkedHashSet<>();
  private final Set<SkyPosition> walking = new LinkedHashSet<>();

  SkyMineGeometry(SkyCell cell) {
    this.cell = cell;
    edits = new SkyEdits(cell);
  }

  SkyPlan build(List<SkyRoute.Segment> edges, SkyMinePlanner.Mouth mouth) {
    for (var edge : edges) passage(edge);
    for (var p : walking) for (var h = 0; h < 3; h++) edits.set(p.above(h), "air");
    for (var edge : edges) timbers(edge);
    for (var p : centers) edits.set(p, "rail[shape=" + rail(p) + "]");
    var direction = direction(mouth.outside(), mouth.inside());
    var spawner = SkyMineTerrain.at(mouth.outside(), direction, 10, 1);
    edits.set(spawner, "spawner");
    edits.set(spawner.above(2), "cobweb");
    var cart = SkyMineTerrain.at(mouth.outside(), direction, 4, 0);
    return new SkyPlan(
        cell,
        SkyCell.Kind.MINE,
        List.of(),
        edits.finish(),
        List.of(new SkyPlan.Resident(cart, SkyPlan.ResidentKind.LOOT_MINECART)));
  }

  private static SkyPosition direction(SkyPosition a, SkyPosition b) {
    var length = Math.abs(b.x() - a.x()) + Math.abs(b.z() - a.z());
    return new SkyPosition((b.x() - a.x()) / length, 0, (b.z() - a.z()) / length);
  }

  private void passage(SkyRoute.Segment edge) {
    var direction = direction(edge.from(), edge.to());
    for (var p : SkyRouteGeometry.points(edge)) {
      centers.add(p);
      for (var side = -2; side <= 2; side++) {
        var q = SkyMineTerrain.at(p, direction, 0, side);
        edits.set(q.above(-1), edge.kind() == SkyRoute.Kind.BRIDGE ? "spruce_planks" : "stone");
        if (Math.abs(side) <= 1) walking.add(q);
      }
    }
  }

  private void timbers(SkyRoute.Segment edge) {
    var direction = direction(edge.from(), edge.to());
    var points = SkyRouteGeometry.points(edge);
    if (edge.kind() == SkyRoute.Kind.BRIDGE) {
      bridge(points, direction);
      return;
    }
    for (var t = 0; t < points.size(); t += 4) frame(points.get(t), direction);
  }

  private void frame(SkyPosition p, SkyPosition direction) {
    for (var side : List.of(-2, 2)) {
      var q = SkyMineTerrain.at(p, direction, 0, side);
      if (!walking.contains(q)) {
        for (var h = 0; h < 3; h++) edits.set(q.above(h), "stripped_spruce_log[axis=y]");
      }
    }
    var axis = direction.x() == 0 ? "x" : "z";
    for (var side = -2; side <= 2; side++) {
      edits.set(
          SkyMineTerrain.at(p, direction, 0, side).above(3), "dark_oak_log[axis=" + axis + "]");
    }
    if (Math.floorMod(p.x() + p.z(), 12) == 0) {
      edits.set(SkyMineTerrain.at(p, direction, 0, 1).above(2), "lantern[hanging=true]");
    }
  }

  private void bridge(List<SkyPosition> points, SkyPosition direction) {
    for (var t = 0; t < points.size(); t++) {
      var p = points.get(t);
      for (var side : List.of(-2, 2)) {
        var q = SkyMineTerrain.at(p, direction, 0, side);
        if (walking.contains(q)) continue;
        edits.set(q, "spruce_fence");
        var cable = 3 - (int) Math.round(1.5 * Math.sin(Math.PI * t / (points.size() - 1)));
        var before =
            3
                - (int)
                    Math.round(1.5 * Math.sin(Math.PI * Math.max(0, t - 1) / (points.size() - 1)));
        for (var h = Math.min(cable, before); h <= Math.max(cable, before); h++) {
          edits.set(q.above(h), "dark_oak_fence");
        }
      }
    }
  }

  private String rail(SkyPosition p) {
    boolean n = centers.contains(p.add(new SkyPosition(0, 0, -1))),
        s = centers.contains(p.add(new SkyPosition(0, 0, 1))),
        e = centers.contains(p.add(new SkyPosition(1, 0, 0))),
        w = centers.contains(p.add(new SkyPosition(-1, 0, 0)));
    if (e && w) return "east_west";
    if (n && s) return "north_south";
    if (s && e) return "south_east";
    if (s && w) return "south_west";
    if (n && e) return "north_east";
    if (n && w) return "north_west";
    return e || w ? "east_west" : "north_south";
  }
}
