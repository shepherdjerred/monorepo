// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/kits/KitInventory.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.kit.KitAccess;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBrowser;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Material;
import org.bukkit.Server;
import org.bukkit.entity.Player;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;

/**
 * The kit menu: a double chest of kit icons in Red Warfare's menu order, {@link #PER_PAGE} to a
 * page, with a control row beneath. Each icon shows the kit's tier and price, whether it is locked,
 * owned or free this week, and its description in Red Warfare's yellow; the kit a player has picked
 * glints. The control row turns pages and shows the player's credits and this week's free kits. It
 * is only ever read: {@code KitMenuListener} cancels every click and drag in it and turns a click
 * on an open kit into the same pick {@code /rwf kit} makes, and a click on a locked kit into the
 * purchase confirmation. One menu per opening; nothing is kept once it closes. Main thread only.
 */
final class KitMenu implements InventoryHolder {

  /** A double chest. */
  static final int SIZE = 54;

  /** Four rows of kits a page. */
  static final int PER_PAGE = 36;

  static final int PREVIOUS = 45;
  static final int CREDITS = 48;
  static final int ROTATION = 50;
  static final int NEXT = 53;
  static final int SORT = 46;
  static final int CATEGORY = 47;
  static final int PAGE = 49;
  static final int ACCESS = 51;
  static final int STREAKS = 52;

  static final Component TITLE = Component.text("Pick a kit", NamedTextColor.DARK_BLUE);

  private final Inventory inventory;
  private final Map<Integer, String> kits = new HashMap<>();
  private final int page;
  private final int pages;
  private final KitBrowser.Query query;

  private KitMenu(Server server, KitFactory items, View view) {
    var filtered = view.query().select(view.kits(), view.access());
    this.pages = Math.max(1, (filtered.size() + PER_PAGE - 1) / PER_PAGE);
    this.page = Math.clamp(view.query().page(), 0, pages - 1);
    this.query = view.query().at(page);
    this.inventory = server.createInventory(this, SIZE, TITLE);
    var shown = filtered.subList(page * PER_PAGE, Math.min(filtered.size(), (page + 1) * PER_PAGE));
    for (var i = 0; i < shown.size(); i++) {
      var kit = shown.get(i);
      kits.put(i, kit.id());
      inventory.setItem(i, items.menuIcon(kit, view.state(kit)));
    }
    if (page > 0) {
      inventory.setItem(PREVIOUS, control(Material.ARROW, "Previous page", List.of()));
    }
    if (page < pages - 1) {
      inventory.setItem(NEXT, control(Material.ARROW, "Next page", List.of()));
    }
    showCredits(view.credits());
    inventory.setItem(ROTATION, rotation(view));
    inventory.setItem(
        STREAKS,
        control(
            Material.FIREWORK_ROCKET,
            "Choose killstreaks",
            List.of("Pick three rewards before the round starts")));
    inventory.setItem(
        SORT,
        control(
            Material.HOPPER,
            "Sort: " + query.sort().displayName(),
            List.of("Click to change order")));
    inventory.setItem(
        CATEGORY,
        control(Material.BOOK, query.categoryLabel(), List.of("Click to change category")));
    inventory.setItem(
        ACCESS,
        control(
            Material.IRON_DOOR,
            query.access().displayName(),
            List.of("Click to change access filter")));
    inventory.setItem(
        PAGE,
        control(
            Material.PAPER,
            "Page " + (page + 1) + " / " + pages,
            List.of(filtered.size() + " matching kits")));
    if (filtered.isEmpty()) {
      inventory.setItem(
          13,
          control(
              Material.BARRIER,
              "No matching kits",
              List.of("Change category or access filter below")));
    }
  }

  /** Shows the player's credits, once read. */
  void showCredits(long credits) {
    showCredits(Optional.of(credits));
  }

  private void showCredits(Optional<Long> credits) {
    inventory.setItem(
        CREDITS,
        control(
            Material.EMERALD,
            "Credits: " + credits.map(String::valueOf).orElse("..."),
            List.of("Earned in Red Warfare matches:", "3 for a win, 1 for a loss")));
  }

  /**
   * Everything one opening shows.
   *
   * @param kits every kit, in menu order
   * @param access what the player may pick
   * @param picked the kit they picked, if any
   * @param rotation this week's free kits
   * @param rotationLeft how long until the rotation changes
   * @param credits their credits, once known
   * @param query the page, sort and filters
   */
  record View(
      List<KitSpec> kits,
      KitAccess access,
      Optional<String> picked,
      List<KitSpec> rotation,
      Duration rotationLeft,
      Optional<Long> credits,
      KitBrowser.Query query) {

    View {
      kits = List.copyOf(kits);
      rotation = List.copyOf(rotation);
    }

    KitFactory.IconState state(KitSpec kit) {
      return new KitFactory.IconState(
          access.lock(kit),
          access.borrowed(kit),
          picked.filter(kit.id()::equals).isPresent(),
          access.expanded() && !access.everything());
    }
  }

  /**
   * Opens kit menus.
   *
   * @param server makes the chest
   * @param items makes the icons
   */
  record Opener(Server server, KitFactory items) {

    /** Opens a fresh menu for {@code player} showing {@code view}. */
    KitMenu open(Player player, View view) {
      var opened = new KitMenu(server, items, view);
      player.openInventory(opened.inventory);
      return opened;
    }
  }

  /** The kit whose icon is in top-inventory slot {@code slot}, if any. */
  Optional<String> kitAt(int slot) {
    return Optional.ofNullable(kits.get(slot));
  }

  int page() {
    return page;
  }

  int pages() {
    return pages;
  }

  KitBrowser.Query query() {
    return query;
  }

  @Override
  public Inventory getInventory() {
    return inventory;
  }

  private static ItemStack rotation(View view) {
    var lines = new ArrayList<String>();
    for (var kit : view.rotation()) {
      lines.add(kit.name() + " (" + kit.tier().displayName() + ")");
    }
    lines.add("Changes in " + left(view.rotationLeft()));
    return control(Material.CLOCK, "Free this week", lines);
  }

  /** {@code left} as days and hours, or hours and minutes under a day. */
  static String left(Duration left) {
    if (left.toDays() > 0) {
      return left.toDays() + "d " + left.toHoursPart() + "h";
    }
    return left.toHours() + "h " + left.toMinutesPart() + "m";
  }

  private static ItemStack control(Material material, String name, List<String> lore) {
    var stack = ItemStack.of(material);
    stack.editMeta(
        meta -> {
          meta.displayName(
              Component.text(name, NamedTextColor.GOLD).decoration(TextDecoration.ITALIC, false));
          meta.lore(
              lore.stream()
                  .map(
                      line ->
                          Component.text(line, NamedTextColor.GRAY)
                              .decoration(TextDecoration.ITALIC, false))
                  .map(Component.class::cast)
                  .toList());
        });
    return stack;
  }

  /** Whether {@code player} has a kit menu open. */
  static boolean showing(Player player) {
    // Only a chest can be the menu; asking a player with nothing open for the top inventory is
    // not something every server implementation answers.
    var view = player.getOpenInventory();
    return view.getType() == InventoryType.CHEST
        && (view.getTopInventory().getHolder() instanceof KitMenu
            || view.getTopInventory().getHolder() instanceof KitPurchaseMenu);
  }

  /** Closes {@code player}'s kit menu or purchase confirmation, if one is open. */
  static void close(Player player) {
    if (showing(player)) {
      player.closeInventory();
    }
  }

  /** The time until {@code end}, never negative. */
  static Duration until(Instant now, Instant end) {
    var left = Duration.between(now, end);
    return left.isNegative() ? Duration.ZERO : left;
  }
}
