package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.IntStream;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Server;
import org.bukkit.entity.Player;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;

/**
 * The kit menu: a 27-slot chest with one icon per shipped kit across its middle row, the picked kit
 * glinting. It is only ever read: {@code KitMenuListener} cancels every click and drag in it and
 * turns a click on an icon into the same pick {@code /rwf kit} makes. One menu per opening; nothing
 * is kept once it closes. Main thread only.
 */
final class KitMenu implements InventoryHolder {

  /** A single chest. */
  static final int SIZE = 27;

  /** The middle row's first slot and its middle slot. */
  private static final int ROW = 9;

  private static final int MIDDLE = 13;

  static final Component TITLE = Component.text("Choose your kit", NamedTextColor.DARK_GRAY);

  private final Inventory inventory;
  private final Map<Integer, String> kits = new HashMap<>();

  private KitMenu(Server server, KitFactory items, List<KitSpec> menu, Optional<String> picked) {
    if (menu.size() > ROW) {
      throw new IllegalArgumentException("the kit menu holds at most " + ROW + " kits");
    }
    this.inventory = server.createInventory(this, SIZE, TITLE);
    var slots = slots(menu.size());
    for (var i = 0; i < menu.size(); i++) {
      var kit = menu.get(i);
      var slot = slots.get(i);
      kits.put(slot, kit.id());
      inventory.setItem(slot, items.icon(kit, picked.filter(kit.id()::equals).isPresent()));
    }
  }

  /**
   * Opens kit menus: the server makes the chest, the kit factory the icons, and the kits are listed
   * in menu order.
   *
   * @param server makes the chest
   * @param items makes the icons
   * @param kits the shipped kits, in menu order
   */
  record Opener(Server server, KitFactory items, List<KitSpec> kits) {

    Opener {
      kits = List.copyOf(kits);
    }

    /** Opens a fresh menu for {@code player}, marking {@code picked}. */
    KitMenu open(Player player, Optional<String> picked) {
      var opened = new KitMenu(server, items, kits, picked);
      player.openInventory(opened.inventory);
      return opened;
    }
  }

  /**
   * The slots {@code count} icons stand in: centred on the middle row, a slot apart when up to five
   * fit that way, side by side otherwise.
   */
  static List<Integer> slots(int count) {
    var spaced = count <= (ROW + 1) / 2;
    var step = spaced ? 2 : 1;
    var first = MIDDLE - (count - 1) * step / 2;
    return IntStream.range(0, count).mapToObj(i -> first + i * step).toList();
  }

  /** The kit whose icon is in top-inventory slot {@code slot}, if any. */
  Optional<String> kitAt(int slot) {
    return Optional.ofNullable(kits.get(slot));
  }

  @Override
  public Inventory getInventory() {
    return inventory;
  }

  /** Whether {@code player} has a kit menu open. */
  static boolean showing(Player player) {
    // Only a chest can be the menu; asking a player with nothing open for the top inventory is
    // not something every server implementation answers.
    var view = player.getOpenInventory();
    return view.getType() == InventoryType.CHEST
        && view.getTopInventory().getHolder() instanceof KitMenu;
  }

  /** Closes {@code player}'s kit menu, if one is open. */
  static void close(Player player) {
    if (showing(player)) {
      player.closeInventory();
    }
  }
}
