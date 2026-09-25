package com.shepherdjerred.thestorm.towns.domain.region;

import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Admin regions indexed by the chunks they overlap, so finding the region at a block costs one map
 * lookup plus a bounds check for the few regions in that chunk. Where regions overlap, the one
 * listed first in config wins, so a small cuboid listed before a large region carves out an
 * exception.
 */
public final class RegionIndex {

  private final List<AdminRegion> regions;
  private final Map<String, Map<Long, List<AdminRegion>>> byChunk;

  public RegionIndex(List<AdminRegion> regions) {
    this.regions = List.copyOf(regions);
    var index = new HashMap<String, Map<Long, List<AdminRegion>>>();
    for (var region : this.regions) {
      for (var area : region.areas().all()) {
        for (var chunk : area.footprint()) {
          var candidates =
              index
                  .computeIfAbsent(chunk.world(), world -> new HashMap<>())
                  .computeIfAbsent(chunk.key(), key -> new ArrayList<>());
          if (!candidates.contains(region)) {
            candidates.add(region);
          }
        }
      }
    }
    var frozen = new HashMap<String, Map<Long, List<AdminRegion>>>();
    index.forEach(
        (world, chunks) -> {
          var copy = new HashMap<Long, List<AdminRegion>>();
          chunks.forEach((key, list) -> copy.put(key, List.copyOf(list)));
          frozen.put(world, Map.copyOf(copy));
        });
    this.byChunk = Map.copyOf(frozen);
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
    var chunks = byChunk.get(world);
    if (chunks == null) {
      return Optional.empty();
    }
    var candidates = chunks.get(ChunkPos.key(x >> 4, z >> 4));
    if (candidates == null) {
      return Optional.empty();
    }
    var block = new BlockPos(world, x, y, z);
    for (var region : candidates) {
      for (var area : region.areas().all()) {
        if (area.contains(block)) {
          return Optional.of(region);
        }
      }
    }
    return Optional.empty();
  }

  /** The first region overlapping any part of {@code chunk}. */
  public Optional<AdminRegion> overlapping(ChunkPos chunk) {
    var chunks = byChunk.get(chunk.world());
    if (chunks == null) {
      return Optional.empty();
    }
    var candidates = chunks.get(chunk.key());
    return candidates == null ? Optional.empty() : Optional.of(candidates.getFirst());
  }
}
