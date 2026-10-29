package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Loadout;
import java.util.List;
import java.util.Optional;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.CrossbowMeta;
import org.jspecify.annotations.Nullable;

/**
 * What the current body can actually use: native ranged weapons with their ammunition, the steaks
 * it carries, and the kit items it still holds that are off cooldown.
 */
final class PaperLoadouts {
  private PaperLoadouts() {}

  /** The hotbar's slots, which is all {@code CombatantActions.consume} eats from. */
  private static final int HOTBAR = 9;

  static Loadout available(Loadout template, Optional<Player> body) {
    var loadout =
        template.withSteakSlot(steakSlot(template, body)).withKitItems(kitItems(template, body));
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

  /**
   * The kit items still in hand and off cooldown: a thrown-away pearl or wind charge stack is gone,
   * and one just thrown cools down as it does for a player.
   */
  private static List<Loadout.KitItem> kitItems(Loadout loadout, Optional<Player> body) {
    if (body.isEmpty()) {
      return loadout.kitItems();
    }
    var player = body.orElseThrow();
    var inventory = player.getInventory();
    return loadout.kitItems().stream()
        .filter(
            item -> {
              var stack = inventory.getItem(item.slot());
              return stack != null && !stack.isEmpty() && !player.hasCooldown(stack);
            })
        .toList();
  }

  /**
   * The hotbar slot holding steak: the kit's own steak slot while it has any left, else the first
   * other hotbar slot a steak landed in (a supply crate's), else -1 once none is left.
   */
  private static int steakSlot(Loadout loadout, Optional<Player> body) {
    if (body.isEmpty()) {
      return -1;
    }
    var inventory = body.orElseThrow().getInventory();
    if (loadout.hasSteak() && isSteak(inventory.getItem(loadout.steakSlot()))) {
      return loadout.steakSlot();
    }
    for (var slot = 0; slot < HOTBAR; slot++) {
      if (isSteak(inventory.getItem(slot))) {
        return slot;
      }
    }
    return -1;
  }

  private static boolean isSteak(@Nullable ItemStack item) {
    return item != null && item.getType() == Material.COOKED_BEEF && item.getAmount() > 0;
  }
}
