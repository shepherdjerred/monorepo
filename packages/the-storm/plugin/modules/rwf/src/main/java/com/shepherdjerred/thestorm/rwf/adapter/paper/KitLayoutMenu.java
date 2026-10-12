// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/kits/KitLayoutInventory.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.kit.KitLayout;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import java.util.Optional;
import java.util.TreeMap;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Server;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;

/**
 * Red Warfare's kit layout editor: the kit's items laid out as the player's inventory, the main
 * inventory in the top three rows and the hotbar in the bottom one. The player moves the items
 * where they want them; the Bomb Fuse stays locked in the first hotbar slot. When it closes, {@code
 * KitLayoutListener} saves where each item ended up as their layout for the kit. Main thread only.
 */
final class KitLayoutMenu implements InventoryHolder {

  /** The player's inventory: three rows and the hotbar. */
  static final int SIZE = KitLayout.INVENTORY_SLOTS;

  /** The hotbar's first slot in the menu, where the fuse is locked. */
  static final int FUSE = 27;

  private static final int HOTBAR = 9;

  private final Inventory inventory;
  private final KitSpec kit;

  private KitLayoutMenu(Server server, KitFactory items, Layout layout) {
    this.kit = layout.kit();
    this.inventory =
        server.createInventory(
            this, SIZE, Component.text(kit.name() + " layout", NamedTextColor.DARK_BLUE));
    for (var placement : KitLayout.place(kit, layout.saved())) {
      var stack =
          placement.index() == 0 ? items.fuse(kit.fuseBonus()) : items.kitItem(placement.item());
      items.keys().tagLayoutIndex(stack, placement.index());
      inventory.setItem(menuSlot(placement.slot()), stack);
    }
  }

  /**
   * What the editor opens with.
   *
   * @param kit the kit
   * @param saved the player's saved layout for it, if any
   */
  record Layout(KitSpec kit, Optional<KitLayout> saved) {}

  /** Opens the editor for {@code layout}'s kit. */
  static KitLayoutMenu open(Server server, KitFactory items, Player player, Layout layout) {
    var menu = new KitLayoutMenu(server, items, layout);
    player.openInventory(menu.inventory);
    return menu;
  }

  KitSpec kit() {
    return kit;
  }

  /** The menu slot that shows inventory slot {@code inventorySlot}. */
  static int menuSlot(int inventorySlot) {
    return inventorySlot < HOTBAR ? inventorySlot + FUSE : inventorySlot - HOTBAR;
  }

  /** The inventory slot menu slot {@code menuSlot} stands for. */
  static int inventorySlot(int menuSlot) {
    return menuSlot >= FUSE ? menuSlot - FUSE : menuSlot + HOTBAR;
  }

  /**
   * Where the player put each item, if every item is still here exactly once and the fuse is still
   * in its slot; empty otherwise.
   */
  Optional<KitLayout> read(Keys keys) {
    var slots = new TreeMap<Integer, Integer>();
    for (var menuSlot = 0; menuSlot < SIZE; menuSlot++) {
      var stack = inventory.getItem(menuSlot);
      if (stack == null || stack.isEmpty()) {
        continue;
      }
      var index = keys.layoutIndex(stack);
      if (index.isEmpty() || slots.put(index.orElseThrow(), inventorySlot(menuSlot)) != null) {
        return Optional.empty();
      }
    }
    var layout = new KitLayout(slots);
    return layout.fits(kit) ? Optional.of(layout) : Optional.empty();
  }

  @Override
  public Inventory getInventory() {
    return inventory;
  }
}
