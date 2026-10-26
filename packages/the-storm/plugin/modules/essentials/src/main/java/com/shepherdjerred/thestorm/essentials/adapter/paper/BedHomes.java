package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.essentials.domain.home.HomeRules;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** The reserved {@code bed} home, remembered so respawn still works after the block is gone. */
final class BedHomes {
  private final Map<UUID, Position> beds = new HashMap<>();

  void remember(UUID player, Position position) {
    beds.put(player, position);
  }

  void forget(UUID player) {
    beds.remove(player);
  }

  Optional<Position> get(UUID player) {
    return Optional.ofNullable(beds.get(player));
  }

  boolean isBed(com.shepherdjerred.thestorm.essentials.domain.place.PlaceName name) {
    return name.equals(HomeRules.BED);
  }
}
