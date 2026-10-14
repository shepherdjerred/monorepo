package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Loadout;
import java.util.Optional;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.meta.CrossbowMeta;

/** Availability of native ranged weapons in the current body, including ammunition in flight. */
final class PaperLoadouts {
  private PaperLoadouts() {}

  static Loadout available(Loadout loadout, Optional<Player> body) {
    if (!loadout.hasBow()) {
      return loadout;
    }
    if (body.isEmpty()) {
      return loadout.withoutRanged();
    }
    var inventory = body.orElseThrow().getInventory();
    var held = inventory.getItem(loadout.bowSlot());
    if (held == null || held.isEmpty()) {
      return loadout.withoutRanged();
    }
    var ready =
        held.getType() == Material.TRIDENT
            || (held.getItemMeta() instanceof CrossbowMeta crossbow
                && crossbow.hasChargedProjectiles())
            || inventory.contains(Material.ARROW)
            || inventory.contains(Material.TIPPED_ARROW)
            || inventory.contains(Material.SPECTRAL_ARROW);
    return ready ? loadout : loadout.withoutRanged();
  }
}
