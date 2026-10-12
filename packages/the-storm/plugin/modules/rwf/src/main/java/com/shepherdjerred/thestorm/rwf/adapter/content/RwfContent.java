package com.shepherdjerred.thestorm.rwf.adapter.content;

import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import java.util.List;
import java.util.Optional;

/**
 * Everything the module loads at enable.
 *
 * @param config {@code rwf.yml}
 * @param kits the kits, as the kit book and {@code kits.yml} agree on them
 * @param maps every map, in id order
 * @param lobby the room players wait in; it overlaps no map and has one alcove per kit
 */
public record RwfContent(
    RwfConfig config, List<KitSpec> kits, List<LoadedMap> maps, LoadedLobby lobby) {

  public RwfContent {
    kits = List.copyOf(kits);
    maps = List.copyOf(maps);
    ContentChecks.validate(maps.stream().map(LoadedMap::definition).toList(), kits, lobby);
  }

  public Optional<LoadedMap> map(String id) {
    return maps.stream().filter(map -> map.id().equals(id)).findFirst();
  }
}
