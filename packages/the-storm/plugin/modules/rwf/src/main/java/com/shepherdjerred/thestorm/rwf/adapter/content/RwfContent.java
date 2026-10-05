package com.shepherdjerred.thestorm.rwf.adapter.content;

import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
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
    if (maps.isEmpty()) {
      throw new IllegalArgumentException("at least one map is required");
    }
    var ids = maps.stream().map(LoadedMap::id).distinct().count();
    if (ids != maps.size()) {
      throw new IllegalArgumentException("map ids must be unique");
    }
    for (var i = 1; i < maps.size(); i++) {
      for (var j = 0; j < i; j++) {
        if (overlap(maps.get(i).definition().border(), maps.get(j).definition().border())) {
          throw new IllegalArgumentException(
              "maps " + maps.get(i).id() + " and " + maps.get(j).id() + " overlap");
        }
      }
    }
    for (var map : maps) {
      if (overlap(lobby.layout().region(), map.definition().border())) {
        throw new IllegalArgumentException("the lobby overlaps map " + map.id());
      }
    }
    var kitIds = kits.stream().map(KitSpec::id).toList();
    if (!lobby.layout().kits().equals(kitIds)) {
      throw new IllegalArgumentException(
          "the lobby's alcoves show " + lobby.layout().kits() + " but the kits are " + kitIds);
    }
  }

  private static boolean overlap(Cuboid p, Cuboid q) {
    return p.min().x() <= q.max().x()
        && q.min().x() <= p.max().x()
        && p.min().y() <= q.max().y()
        && q.min().y() <= p.max().y()
        && p.min().z() <= q.max().z()
        && q.min().z() <= p.max().z();
  }

  public Optional<LoadedMap> map(String id) {
    return maps.stream().filter(map -> map.id().equals(id)).findFirst();
  }
}
