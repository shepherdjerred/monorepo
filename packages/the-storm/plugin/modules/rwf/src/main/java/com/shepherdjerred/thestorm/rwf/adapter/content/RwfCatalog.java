package com.shepherdjerred.thestorm.rwf.adapter.content;

import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import java.util.List;

/** Runtime metadata for all maps; terrain is retained only by prepared MapWorld instances. */
public record RwfCatalog(
    RwfConfig config, List<KitSpec> kits, List<MapSource> maps, LoadedLobby lobby) {
  public RwfCatalog {
    kits = List.copyOf(kits);
    maps = List.copyOf(maps);
    ContentChecks.validate(maps.stream().map(MapSource::definition).toList(), kits, lobby);
  }
}
