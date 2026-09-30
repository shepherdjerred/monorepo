package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.qol.domain.grave.GravePos;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.Player;

/**
 * The last place each online player stood safely: solid ground underfoot, no hazard at their feet.
 * A grave for a death in the void or in lava goes there. Main thread only.
 */
final class LastSafeSpots {

  private final Map<UUID, GravePos> spots = new HashMap<>();

  /** Records where {@code player} stands, if it is safe. */
  void sample(Player player) {
    if (player.isDead()) {
      return;
    }
    var feet = Blocks.at(player).getBlock();
    var ground = feet.getRelative(BlockFace.DOWN);
    var safe =
        ground.getType().isSolid()
            && !Blocks.HAZARDS.contains(ground.getType())
            && !Blocks.HAZARDS.contains(feet.getType())
            && !feet.getType().isSolid()
            && !feet.isLiquid();
    if (safe) {
      spots.put(player.getUniqueId(), Blocks.pos(feet));
    }
  }

  Optional<GravePos> of(UUID player) {
    return Optional.ofNullable(spots.get(player));
  }

  void forget(UUID player) {
    spots.remove(player);
  }
}
