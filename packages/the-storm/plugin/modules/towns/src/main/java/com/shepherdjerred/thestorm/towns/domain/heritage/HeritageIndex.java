package com.shepherdjerred.thestorm.towns.domain.heritage;

import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Chunk-indexed immutable floor; a proven editing footprint wins over overlapping buffers. */
public final class HeritageIndex {
  private final List<HeritageSite> sites;
  private final Map<ChunkPos, List<HeritageSite>> chunks = new HashMap<>();

  public HeritageIndex(List<HeritageSite> sites) {
    this.sites = List.copyOf(sites);
    for (var site : sites) {
      for (var chunk : site.footprint()) {
        chunks.computeIfAbsent(chunk, ignored -> new ArrayList<>()).add(site);
      }
    }
  }

  public List<HeritageSite> sites() {
    return sites;
  }

  public Land protect(
      com.shepherdjerred.thestorm.towns.domain.land.BlockPos position, Land underlying) {
    var world = position.world();
    var x = position.x();
    var y = position.y();
    var z = position.z();
    var candidates = chunks.getOrDefault(ChunkPos.ofBlock(world, x, z), List.of());
    HeritageSite first = null;
    for (var site : candidates) {
      if (!site.contains(x, y, z)) continue;
      if (first == null) first = site;
      var editors = site.editorsAt(x, z);
      if (!editors.isEmpty()) return new Land.HeritageLand(site, editors, underlying);
    }
    return first == null
        ? underlying
        : new Land.HeritageLand(first, java.util.Set.of(), underlying);
  }
}
