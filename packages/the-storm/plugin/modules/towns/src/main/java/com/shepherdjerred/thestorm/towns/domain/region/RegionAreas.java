package com.shepherdjerred.thestorm.towns.domain.region;

import java.util.List;
import java.util.stream.Stream;

/**
 * The areas making up one region. Either list may be empty, but not both.
 *
 * @param chunks whole-chunk ranges
 * @param cuboids block boxes
 */
public record RegionAreas(List<ChunkRange> chunks, List<Cuboid> cuboids) {

  public RegionAreas {
    chunks = List.copyOf(chunks);
    cuboids = List.copyOf(cuboids);
    if (chunks.isEmpty() && cuboids.isEmpty()) {
      throw new IllegalArgumentException("a region needs at least one chunk range or cuboid");
    }
  }

  /** Every area, chunk ranges first. */
  public List<Area> all() {
    return Stream.concat(chunks.stream(), cuboids.stream()).map(Area.class::cast).toList();
  }
}
