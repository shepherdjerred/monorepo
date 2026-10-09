package com.shepherdjerred.thestorm.rwf.adapter.content;

import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import java.util.List;

/** The same metadata invariants apply to eager tools and the bounded runtime catalog. */
final class ContentChecks {
  private ContentChecks() {}

  static void validate(List<MapDefinition> maps, List<KitSpec> kits, LoadedLobby lobby) {
    if (maps.isEmpty()) throw new IllegalArgumentException("at least one map is required");
    if (maps.stream().map(MapDefinition::id).distinct().count() != maps.size())
      throw new IllegalArgumentException("map ids must be unique");
    for (var i = 1; i < maps.size(); i++) {
      for (var j = 0; j < i; j++) {
        if (overlap(maps.get(i).border(), maps.get(j).border()))
          throw new IllegalArgumentException(
              "maps " + maps.get(i).id() + " and " + maps.get(j).id() + " overlap");
      }
    }
    for (var map : maps) {
      if (overlap(lobby.layout().region(), map.border()))
        throw new IllegalArgumentException("the lobby overlaps map " + map.id());
    }
    var kitIds = kits.stream().map(KitSpec::id).toList();
    if (!lobby.layout().kits().equals(kitIds))
      throw new IllegalArgumentException(
          "the lobby's alcoves show " + lobby.layout().kits() + " but the kits are " + kitIds);
  }

  private static boolean overlap(Cuboid p, Cuboid q) {
    return p.min().x() <= q.max().x()
        && q.min().x() <= p.max().x()
        && p.min().y() <= q.max().y()
        && q.min().y() <= p.max().y()
        && p.min().z() <= q.max().z()
        && q.min().z() <= p.max().z();
  }
}
