package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.entity.Player;

/**
 * The last safe block each online player stood on, so a death in lava or the void records a place
 * {@code /back} can actually return to. Main thread only.
 */
final class SafeTracker {

  private final Map<UUID, Position> lastSafe = new HashMap<>();

  /** {@code player} moved into {@code to}'s block. */
  void moved(Player player, Location to) {
    if (SafeLocations.isSafe(to)) {
      lastSafe.put(player.getUniqueId(), Positions.of(to));
    }
  }

  /** Where to record {@code player}'s death: where they died if safe, else their last safe spot. */
  Optional<Position> deathPoint(Player player) {
    var here = Positions.current(player);
    if (SafeLocations.isSafe(here)) {
      return Optional.of(Positions.of(here));
    }
    return Optional.ofNullable(lastSafe.get(player.getUniqueId()));
  }

  /** {@code player} left. */
  void forget(UUID player) {
    lastSafe.remove(player);
  }
}
