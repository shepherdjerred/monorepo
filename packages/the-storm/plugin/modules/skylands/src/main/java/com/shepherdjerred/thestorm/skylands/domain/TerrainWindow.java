package com.shepherdjerred.thestorm.skylands.domain;

import java.util.HashMap;
import java.util.Map;

/** Short-lived, thread-confined column memo used while one feature cell is planned. */
public final class TerrainWindow {
  private final LayeredLandscape landscape;
  private final Map<Long, LayeredLandscape.Column> columns = new HashMap<>();

  public TerrainWindow(LayeredLandscape landscape) {
    this.landscape = landscape;
  }

  public LayeredLandscape.Column column(int x, int z) {
    return columns.computeIfAbsent(
        LayeredLandscape.columnKey(x, z), ignored -> landscape.column(x, z));
  }

  public boolean solid(SkyPosition p) {
    return column(p.x(), p.z()).solid(p.y());
  }

  public boolean air(SkyPosition p) {
    var c = column(p.x(), p.z());
    return !c.solid(p.y()) && !c.water(p.y());
  }

  public boolean footing(SkyPosition p, int depth) {
    for (var d = 0; d <= depth; d++) {
      if (solid(p.above(-d))) return true;
      if (!air(p.above(-d))) return false;
    }
    return false;
  }
}
