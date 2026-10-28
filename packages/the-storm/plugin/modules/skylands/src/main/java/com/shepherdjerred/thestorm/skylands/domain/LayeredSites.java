package com.shepherdjerred.thestorm.skylands.domain;

import java.util.LinkedHashMap;
import java.util.List;

/** Bounded deterministic plan memo. Locks only coordinate duplicate CPU work, never world I/O. */
public final class LayeredSites {
  private final LayeredLandscape landscape;
  private final SkyDistrictPlanner districts;
  private final SkyMinePlanner mines;
  private final LinkedHashMap<SkyCell, SkyPlan> plans = new LinkedHashMap<>();
  private final List<Object> stripes =
      java.util.stream.IntStream.range(0, 16).mapToObj(ignored -> new Object()).toList();

  public LayeredSites(LayeredLandscape landscape, List<SkyTemplate> templates) {
    this.landscape = landscape;
    districts = new SkyDistrictPlanner(landscape, templates);
    mines = new SkyMinePlanner(landscape);
  }

  public SkyPlan forChunk(int x, int z) {
    return plan(SkyCell.atChunk(x, z));
  }

  /** Vanilla feature writes may reach neighbouring chunks; preserve a bounded feature halo. */
  public boolean protectsChunk(int x, int z) {
    var bounds =
        new SkyBounds(
            new SkyPosition(x * 16 - 32, LayeredLandscape.MIN_Y, z * 16 - 32),
            new SkyPosition(x * 16 + 47, LayeredLandscape.MAX_Y - 1, z * 16 + 47));
    var first = SkyCell.atChunk(x - 2, z - 2);
    var last = SkyCell.atChunk(x + 2, z + 2);
    for (var cx = first.x(); cx <= last.x(); cx++) {
      for (var cz = first.z(); cz <= last.z(); cz++) {
        if (plan(new SkyCell(cx, cz)).intersects(bounds)) return true;
      }
    }
    return false;
  }

  public SkyPlan plan(SkyCell cell) {
    synchronized (stripes.get(Math.floorMod(cell.hashCode(), stripes.size()))) {
      synchronized (plans) {
        var found = plans.get(cell);
        if (found != null) return found;
      }
      var kind = cell.kind(landscape.seed());
      var result =
          switch (kind) {
            case VILLAGE, ANCIENT_CITY -> districts.plan(cell);
            case MINE -> mines.plan(cell);
            case WILDERNESS -> SkyPlan.empty(cell, kind);
          };
      synchronized (plans) {
        plans.put(cell, result);
        if (plans.size() > 64) plans.pollFirstEntry();
      }
      return result;
    }
  }
}
