// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/kits/KitPurchaseInventory.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import java.util.List;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Material;
import org.bukkit.Server;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;

/**
 * Red Warfare's purchase confirmation: the kit with its price in the middle of the top row, a green
 * CONFIRM and a red CANCEL below. {@code KitMenuListener} turns CONFIRM into the purchase and
 * CANCEL into the kit menu again. Main thread only.
 */
final class KitPurchaseMenu implements InventoryHolder {

  static final int SIZE = 27;
  static final int KIT = 4;
  static final int CONFIRM = 20;
  static final int CANCEL = 24;

  private final Inventory inventory;
  private final KitSpec kit;

  private KitPurchaseMenu(Server server, KitFactory items, KitSpec kit) {
    this.kit = kit;
    this.inventory =
        server.createInventory(
            this, SIZE, Component.text("Purchase " + kit.name(), NamedTextColor.DARK_BLUE));
    var icon = items.icon(kit, false);
    icon.lore(
        List.of(
            Component.text("Price: ", NamedTextColor.DARK_AQUA)
                .decoration(TextDecoration.ITALIC, false)
                .append(Component.text(kit.price() + " credits", NamedTextColor.AQUA))));
    inventory.setItem(KIT, icon);
    inventory.setItem(CONFIRM, button(Material.LIME_WOOL, "CONFIRM", NamedTextColor.DARK_GREEN));
    inventory.setItem(CANCEL, button(Material.RED_WOOL, "CANCEL", NamedTextColor.DARK_RED));
  }

  /** Opens the confirmation for {@code kit}. */
  static KitPurchaseMenu open(Server server, KitFactory items, Player player, KitSpec kit) {
    var menu = new KitPurchaseMenu(server, items, kit);
    player.openInventory(menu.inventory);
    return menu;
  }

  KitSpec kit() {
    return kit;
  }

  @Override
  public Inventory getInventory() {
    return inventory;
  }

  private static ItemStack button(Material material, String text, NamedTextColor color) {
    var stack = ItemStack.of(material);
    stack.editMeta(
        meta ->
            meta.displayName(
                Component.text(text, color, TextDecoration.BOLD)
                    .decoration(TextDecoration.ITALIC, false)));
    return stack;
  }
}
