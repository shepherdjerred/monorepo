package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.BotSettings;
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
 * One immutable settings view; clicks always recheck host ownership against the current session.
 */
final class SettingsMenu implements InventoryHolder {
  static final int SIZE = 27;
  static final int AUTO = 10;
  static final int OFF = 11;
  static final int LESS = 12;
  static final int COUNT = 13;
  static final int MORE = 14;
  static final int DIFFICULTY = 15;

  private final Inventory inventory;

  record View(BotSettings options, String host, boolean editable, boolean locked) {}

  private SettingsMenu(Server server, View view) {
    var options = view.options();
    var host = view.host();
    var editable = view.editable();
    var locked = view.locked();
    inventory =
        server.createInventory(
            this, SIZE, Component.text("Match settings", NamedTextColor.DARK_BLUE));
    inventory.setItem(
        4,
        item(
            Material.PLAYER_HEAD,
            "Host: " + host,
            editable ? "You are the host" : "Only the host can change settings",
            locked ? "Changes apply next round" : "Changes apply this round",
            "Matches start automatically"));
    inventory.setItem(
        AUTO, item(Material.CLOCK, "Bots: Auto", "Use the map's recommended population"));
    inventory.setItem(
        OFF, item(Material.BARRIER, "Bots: Off", "A second player is needed to start"));
    inventory.setItem(LESS, item(Material.REDSTONE, "Fewer bots", "Click: -1; shift-click: -5"));
    inventory.setItem(
        COUNT,
        item(
            Material.IRON_HELMET,
            "Population: " + options.populationLabel(),
            "The count excludes human players"));
    inventory.setItem(MORE, item(Material.EMERALD, "More bots", "Click: +1; shift-click: +5"));
    inventory.setItem(
        DIFFICULTY,
        item(
            Material.IRON_SWORD,
            "Difficulty: " + options.difficulty().displayName(),
            "Click to cycle Easy / Normal / Hard",
            "Bots keep their individual personalities"));
    if (locked) {
      inventory.setItem(
          22,
          item(
              Material.PAPER, "Next-round settings", "The current round's bots are already fixed"));
    }
  }

  static void open(Server server, Player player, View view) {
    player.openInventory(new SettingsMenu(server, view).inventory);
  }

  private static ItemStack item(Material material, String title, String... lore) {
    var stack = ItemStack.of(material);
    stack.editMeta(
        meta -> {
          meta.displayName(
              Component.text(title, NamedTextColor.GOLD).decoration(TextDecoration.ITALIC, false));
          meta.lore(
              List.of(lore).stream()
                  .map(
                      line ->
                          Component.text(line, NamedTextColor.GRAY)
                              .decoration(TextDecoration.ITALIC, false))
                  .map(Component.class::cast)
                  .toList());
        });
    return stack;
  }

  @Override
  public Inventory getInventory() {
    return inventory;
  }
}
