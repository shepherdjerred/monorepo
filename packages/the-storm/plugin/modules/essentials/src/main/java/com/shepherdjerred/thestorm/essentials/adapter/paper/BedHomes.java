package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.essentials.domain.home.HomeRules;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.entity.Player;

/** The reserved {@code bed} home, remembered so respawn still works after the block is gone. */
final class BedHomes {
  private final Map<UUID, Position> beds = new HashMap<>();

  void remember(UUID player, Position position) {
    beds.put(player, position);
  }

  /** Remembers {@code position} and forces it as the vanilla respawn, even if the bed is gone. */
  void keep(Player player, Position position) {
    remember(player.getUniqueId(), position);
    Positions.toLocation(player.getServer(), position)
        .ifPresent(spot -> player.setRespawnLocation(spot, true));
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
