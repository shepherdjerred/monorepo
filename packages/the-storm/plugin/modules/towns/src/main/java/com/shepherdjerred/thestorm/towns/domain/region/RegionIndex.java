package com.shepherdjerred.thestorm.towns.domain.region;

import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.jspecify.annotations.Nullable;

/**
 * Admin regions grouped by world, as flat arrays of (area, region) pairs in config order, so
 * finding the region at a block allocates nothing: one map lookup for the world, then a bounds
 * check per area. There are only a handful of regions, and every block event asks. Where regions
 * overlap, the one listed first in config wins, so a small cuboid listed before a large region
 * carves out an exception.
 */
public final class RegionIndex {

  private final List<AdminRegion> regions;
  private final Map<String, Area[]> areasByWorld;
  private final Map<String, AdminRegion[]> ownersByWorld;

  public RegionIndex(List<AdminRegion> regions) {
    this.regions = List.copyOf(regions);
    var areas = new HashMap<String, List<Area>>();
    var owners = new HashMap<String, List<AdminRegion>>();
    for (var region : this.regions) {
      for (var area : region.areas().all()) {
        areas.computeIfAbsent(area.world(), world -> new ArrayList<>()).add(area);
        owners.computeIfAbsent(area.world(), world -> new ArrayList<>()).add(region);
      }
    }
    var areaArrays = new HashMap<String, Area[]>();
    var ownerArrays = new HashMap<String, AdminRegion[]>();
    areas.forEach((world, list) -> areaArrays.put(world, list.toArray(Area[]::new)));
    owners.forEach((world, list) -> ownerArrays.put(world, list.toArray(AdminRegion[]::new)));
    this.areasByWorld = Map.copyOf(areaArrays);
    this.ownersByWorld = Map.copyOf(ownerArrays);
  }

  /** Every region, in config order. */
  public List<AdminRegion> all() {
    return regions;
  }

  public Optional<AdminRegion> byId(String id) {
    return regions.stream().filter(region -> region.id().equals(id)).findFirst();
  }

  /** The first region, in config order, containing block ({@code x}, {@code y}, {@code z}). */
  public Optional<AdminRegion> at(String world, int x, int y, int z) {
    return Optional.ofNullable(regionAt(world, x, y, z));
  }

  /** As {@link #at}, without allocating: null when no region contains the block. */
  public @Nullable AdminRegion regionAt(String world, int x, int y, int z) {
    var areas = areasByWorld.get(world);
    if (areas == null) {
      return null;
    }
    var owners = ownersByWorld.get(world);
    if (owners == null) {
      throw new IllegalStateException("regions of " + world + " are indexed without owners");
    }
    for (var i = 0; i < areas.length; i++) {
      if (areas[i].contains(world, x, y, z)) {
        return owners[i];
      }
    }
    return null;
  }

  /** The first region overlapping any part of {@code chunk}. */
  public Optional<AdminRegion> overlapping(ChunkPos chunk) {
    for (var region : regions) {
      for (var area : region.areas().all()) {
        if (area.world().equals(chunk.world()) && area.footprintContains(chunk)) {
          return Optional.of(region);
        }
      }
    }
    return Optional.empty();
  }
}
