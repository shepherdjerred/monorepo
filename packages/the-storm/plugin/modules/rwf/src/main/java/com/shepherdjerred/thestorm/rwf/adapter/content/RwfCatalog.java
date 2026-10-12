package com.shepherdjerred.thestorm.rwf.adapter.content;

import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import java.util.List;

/**
 * Runtime metadata for all maps; terrain is retained only by prepared MapWorld instances. Every map
 * is validated, and the ones {@code rwf.yml} quarantines are left out of the {@link #rotation}. A
 * quarantine entry for a map that is not staged (a test server with a few maps) keeps nothing out;
 * the content tests hold the shipped entries to the shipped maps.
 */
public record RwfCatalog(
    RwfConfig config, List<KitSpec> kits, List<MapSource> maps, LoadedLobby lobby) {
  public RwfCatalog {
    kits = List.copyOf(kits);
    maps = List.copyOf(maps);
    ContentChecks.validate(maps.stream().map(MapSource::definition).toList(), kits, lobby);
    if (maps.stream().allMatch(map -> config.quarantine().containsKey(map.id()))) {
      throw new IllegalStateException("rwf.yml quarantines every map; none is left to play");
    }
  }

  /** The maps matches are played on, in id order: every map not quarantined. */
  public List<MapSource> rotation() {
    return maps.stream().filter(map -> !config.quarantine().containsKey(map.id())).toList();
  }
}
