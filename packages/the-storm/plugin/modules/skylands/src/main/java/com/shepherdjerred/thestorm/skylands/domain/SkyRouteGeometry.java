package com.shepherdjerred.thestorm.skylands.domain;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Terrain-following lanes, bounded passages and rock-anchored crossings. */
final class SkyRouteGeometry {
  private final SkyEdits edits;
  private final TerrainWindow terrain;
  private final List<SkyPiece> pieces;
  private final Set<SkyPosition> walking = new HashSet<>();
  private final Set<SkyPosition> lanes = new HashSet<>();
  private final boolean desert;

  SkyRouteGeometry(SkyEdits edits, TerrainWindow terrain, List<SkyPiece> pieces) {
    this.edits = edits;
    this.terrain = terrain;
    this.pieces = List.copyOf(pieces);
    desert = pieces.stream().anyMatch(p -> p.template().key().startsWith("village/desert/"));
  }

  void apply(List<SkyRoute> routes, boolean ruins) {
    for (var route : routes) for (var edge : route.segments()) walking.addAll(points(edge));
    for (var p : walking) lane(p, ruins);
    for (var p : walking) verges(p, ruins);
    for (var route : routes) {
      for (var edge : route.segments()) detail(edge, ruins);
    }
  }

  static List<SkyPosition> points(SkyRoute.Segment edge) {
    var result = new ArrayList<SkyPosition>();
    var a = edge.from();
    var b = edge.to();
    if (edge.kind() == SkyRoute.Kind.CLIFF) return List.of(a, b);
    var steps = Math.max(1, Math.abs(b.x() - a.x()) + Math.abs(b.z() - a.z()));
    for (var t = 0; t <= steps; t++) {
      result.add(
          new SkyPosition(
              a.x() + (b.x() - a.x()) * t / steps,
              a.y() + (b.y() - a.y()) * t / steps,
              a.z() + (b.z() - a.z()) * t / steps));
    }
    return List.copyOf(result);
  }

  private boolean plot(SkyPosition p) {
    return pieces.stream().anyMatch(piece -> piece.bounds().contains(p));
  }

  private void lane(SkyPosition p, boolean ruins) {
    if (plot(p)) throw new IllegalStateException("Route entered a planned building " + p);
    edits.set(p.above(-1), surface(ruins));
    lanes.add(p);
    for (var h = 0; h < 3; h++) edits.set(p.above(h), "air");
    for (var d = 2; d <= 3; d++) {
      var below = p.above(-d);
      if (!terrain.solid(below) && terrain.footing(below, 3 - d)) {
        edits.set(below, ruins ? "cobbled_deepslate" : "cobblestone");
      }
    }
  }

  private String surface(boolean ruins) {
    if (ruins) return "gray_wool";
    return desert ? "smooth_sandstone" : "dirt_path";
  }

  private String edge(SkyPosition p, boolean ruins) {
    var wear = SkyRandom.noise(p.x() / 7.0, p.y() / 11.0, p.z() / 7.0, terrain.seed() + 2777);
    if (wear < .42) return surface(ruins);
    if (ruins) return "deepslate_tiles";
    return desert ? "sandstone" : "coarse_dirt";
  }

  private void verges(SkyPosition p, boolean ruins) {
    for (var direction :
        List.of(
            new SkyPosition(1, 0, 0),
            new SkyPosition(-1, 0, 0),
            new SkyPosition(0, 0, 1),
            new SkyPosition(0, 0, -1))) {
      var q = p.add(direction);
      if (!side(q)) continue;
      edits.set(q.above(-1), edge(q, ruins));
      lanes.add(q);
      for (var h = 0; h < 3; h++) edits.set(q.above(h), "air");
      lamp(q.add(direction), ruins);
    }
  }

  private boolean side(SkyPosition p) {
    return edits.owns(new SkyBounds(p.above(-1), p.above(2)))
        && !walking.contains(p)
        && !edits.contains(p)
        && !plot(p)
        && !plot(p.above(-1))
        && !plot(p.above(2))
        && terrain.solid(p.above(-1))
        && terrain.air(p)
        && terrain.air(p.above(1))
        && terrain.air(p.above(2))
        && walking.stream().noneMatch(w -> w.x() == p.x() && w.z() == p.z() && w.y() != p.y());
  }

  private void lamp(SkyPosition p, boolean ruins) {
    if (Math.floorMod(SkyRandom.hash(p, terrain.seed() + 2789), 29) != 0 || !side(p)) return;
    edits.set(p, ruins ? "cobbled_deepslate_wall" : "oak_fence");
    edits.set(p.above(1), ruins ? "soul_lantern" : "lantern");
  }

  private void detail(SkyRoute.Segment edge, boolean ruins) {
    switch (edge.kind()) {
      case WALK -> stairs(edge, ruins);
      case BRIDGE -> bridge(edge, ruins);
      case CLIFF -> cliff(edge);
    }
  }

  private void stairs(SkyRoute.Segment edge, boolean ruins) {
    var low = edge.from().y() < edge.to().y() ? edge.from() : edge.to();
    var high = low.equals(edge.from()) ? edge.to() : edge.from();
    if (low.y() == high.y()) return;
    var face = facing(high.x() - low.x(), high.z() - low.z());
    var stair =
        ruins
            ? "cobbled_deepslate_stairs"
            : desert ? "smooth_sandstone_stairs" : "cobblestone_stairs";
    var dx = high.x() - low.x();
    var dz = high.z() - low.z();
    for (var side = -1; side <= 1; side++) {
      var offset = new SkyPosition(-dz * side, 0, dx * side);
      if (lanes.contains(low.add(offset)) && lanes.contains(high.add(offset)))
        edits.set(low.add(offset), stair + "[facing=" + face + "]");
    }
  }

  private void bridge(SkyRoute.Segment edge, boolean ruins) {
    var a = edge.from();
    var b = edge.to();
    var length = Math.abs(b.x() - a.x()) + Math.abs(b.z() - a.z());
    int dx = (b.x() - a.x()) / length, dz = (b.z() - a.z()) / length;
    var wood = ruins ? "dark_oak" : "spruce";
    for (var t = 0; t <= length; t++) {
      bridgeSection(
          new SkyPosition(a.x() + dx * t, a.y(), a.z() + dz * t),
          new SkyPosition(-dz, 0, dx),
          wood,
          t == 0 || t == length);
    }
  }

  private void bridgeSection(SkyPosition p, SkyPosition side, String wood, boolean endpoint) {
    for (var s = -2; s <= 2; s++) {
      var q = p.add(new SkyPosition(side.x() * s, 0, side.z() * s));
      if (plot(q)) continue;
      edits.set(q.above(-1), wood + "_planks");
      if (Math.abs(s) < 2) {
        for (var h = 0; h < 3; h++) edits.set(q.above(h), "air");
      } else {
        edits.set(q, wood + "_fence");
        if (endpoint) {
          edits.set(q.above(1), wood + "_fence");
          edits.set(q.above(2), "soul_lantern");
        }
      }
    }
  }

  private void cliff(SkyRoute.Segment edge) {
    var low = edge.from().y() < edge.to().y() ? edge.from() : edge.to();
    var high = low.equals(edge.from()) ? edge.to() : edge.from();
    var face = facing(low.x() - high.x(), low.z() - high.z());
    for (var y = low.y(); y < high.y(); y++) {
      edits.set(new SkyPosition(low.x(), y, low.z()), "ladder[facing=" + face + "]");
    }
  }

  static String facing(int dx, int dz) {
    if (dx > 0) return "east";
    if (dx < 0) return "west";
    return dz > 0 ? "south" : "north";
  }
}
