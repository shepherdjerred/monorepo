package com.shepherdjerred.thestorm.skylands.domain;

import java.util.List;
import java.util.Optional;

/** Galleries need existing rock and floors. Crossings need supported ends and a real gap. */
final class SkyMineTerrain {
  static final List<SkyPosition> DIRECTIONS =
      List.of(
          new SkyPosition(1, 0, 0),
          new SkyPosition(0, 0, 1),
          new SkyPosition(-1, 0, 0),
          new SkyPosition(0, 0, -1));
  private final TerrainWindow terrain;
  private final SkyBounds bounds;

  SkyMineTerrain(TerrainWindow terrain, SkyBounds bounds) {
    this.terrain = terrain;
    this.bounds = bounds;
  }

  static SkyPosition at(SkyPosition p, SkyPosition direction, int forward, int side) {
    return p.add(
        new SkyPosition(
            direction.x() * forward - direction.z() * side,
            0,
            direction.z() * forward + direction.x() * side));
  }

  boolean tube(SkyPosition a, SkyPosition b) {
    var length = Math.abs(b.x() - a.x()) + Math.abs(b.z() - a.z());
    var direction = new SkyPosition((b.x() - a.x()) / length, 0, (b.z() - a.z()) / length);
    int rock = 0, cells = 0;
    for (var t = 0; t <= length; t++) {
      for (var side = -2; side <= 2; side++) {
        var p = at(a, direction, t, side);
        var count = sectionRock(p);
        if (count < 0) return false;
        rock += count;
        cells += 4;
      }
    }
    return rock >= cells * .68;
  }

  private int sectionRock(SkyPosition p) {
    if (!safe(p) || !terrain.solid(p.above(-1))) return -1;
    var rock = 0;
    for (var y = 0; y < 4; y++) {
      if (terrain.solid(p.above(y))) rock++;
      else if (!terrain.air(p.above(y))) return -1;
    }
    return rock;
  }

  private boolean safe(SkyPosition p) {
    return bounds.contains(p.above(-3)) && bounds.contains(p.above(5));
  }

  boolean mouth(SkyPosition p, SkyPosition direction) {
    var outside = at(p, direction, -2, 0);
    return terrain.air(outside)
        && terrain.air(outside.above(1))
        && tube(p, at(p, direction, 12, 0));
  }

  Optional<SkyPosition> crossing(SkyPosition a, SkyPosition direction) {
    for (var length = 8; length <= 40; length += 4) {
      var b = at(a, direction, length, 0);
      if (!landing(b, direction) || !tube(b, at(b, direction, 4, 0))) continue;
      if (span(a, direction, length)) return Optional.of(b);
    }
    return Optional.empty();
  }

  private boolean landing(SkyPosition p, SkyPosition direction) {
    for (var side = -2; side <= 2; side++) {
      var q = at(p, direction, 0, side);
      if (!safe(q) || !terrain.solid(q.above(-1))) return false;
    }
    return true;
  }

  private boolean span(SkyPosition a, SkyPosition direction, int length) {
    if (!landing(a, direction)) return false;
    var gap = 0;
    for (var t = 1; t < length; t++) {
      if (!clearSection(at(a, direction, t, 0), direction)) return false;
      var p = at(a, direction, t, 0);
      if (terrain.air(p.above(-1)) && terrain.air(p.above(-4))) gap++;
    }
    return gap >= 4;
  }

  private boolean clearSection(SkyPosition p, SkyPosition direction) {
    for (var side = -2; side <= 2; side++) {
      var q = at(p, direction, 0, side);
      if (!safe(q)) return false;
      for (var y = 0; y < 4; y++) {
        if (!terrain.air(q.above(y)) && !terrain.solid(q.above(y))) return false;
      }
    }
    return true;
  }
}
