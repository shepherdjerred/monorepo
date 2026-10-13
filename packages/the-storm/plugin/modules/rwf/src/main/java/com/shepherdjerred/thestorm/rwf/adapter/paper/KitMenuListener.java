package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.kit.KitAccess;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.inventory.InventoryView;

/**
 * The kit menu and the purchase confirmation are read-only: every click and drag while one is open
 * is cancelled, in the chest and in the player's own inventory below it, before any other listener
 * sees it. A click on an open kit picks it through the same path as {@code /rwf kit} and the menu
 * closes on the next tick, once the click is over; a click on a kit they have not bought opens the
 * purchase confirmation, whose CONFIRM buys it and whose CANCEL goes back to the menu. The arrows
 * turn pages.
 */
final class KitMenuListener implements Listener {

  private final MatchRunner runner;
  private final PaperContext context;
  private final KitMenus menus;

  KitMenuListener(MatchRunner runner, PaperContext context, KitMenus menus) {
    this.runner = runner;
    this.context = context;
    this.menus = menus;
  }

  private static boolean menu(InventoryView view) {
    var holder = view.getTopInventory().getHolder();
    return holder instanceof KitMenu || holder instanceof KitPurchaseMenu;
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void onClick(InventoryClickEvent event) {
    var view = event.getView();
    if (!menu(view)) {
      return;
    }
    event.setCancelled(true);
    if (!(event.getWhoClicked() instanceof Player player) || event.getRawSlot() < 0) {
      return;
    }
    switch (view.getTopInventory().getHolder()) {
      case KitMenu kitMenu when event.getRawSlot() < KitMenu.SIZE && event.isRightClick() ->
          layoutClick(player, kitMenu, event.getRawSlot());
      case KitMenu kitMenu when event.getRawSlot() < KitMenu.SIZE ->
          kitMenuClick(player, kitMenu, event.getRawSlot());
      case KitPurchaseMenu purchase when event.getRawSlot() < KitPurchaseMenu.SIZE ->
          purchaseClick(player, purchase, event.getRawSlot());
      case null, default -> {}
    }
  }

  private void kitMenuClick(Player player, KitMenu menu, int slot) {
    if (slot == KitMenu.PREVIOUS && menu.page() > 0) {
      later(() -> runner.picker().browse(player, menu.page() - 1));
      return;
    }
    if (slot == KitMenu.NEXT && menu.page() < menu.pages() - 1) {
      later(() -> runner.picker().browse(player, menu.page() + 1));
      return;
    }
    var kitId = menu.kitAt(slot);
    if (kitId.isEmpty()) {
      return;
    }
    var kit = KitBook.byId(kitId.orElseThrow()).orElseThrow();
    var lock = menus.armory().access(player.getUniqueId()).flatMap(access -> access.lock(kit));
    if (lock.filter(KitAccess.Lock.NOT_OWNED::equals).isPresent()) {
      later(() -> menus.confirm(player, kit));
      return;
    }
    if (lock.isPresent()) {
      Texts.error(player, kit.name() + " is not offered to you.");
      return;
    }
    runner
        .picker()
        .pick(player, kit.id())
        .ifPresentOrElse(
            refusal -> Texts.error(player, refusal), () -> later(() -> KitMenu.close(player)));
  }

  /** A right-click on a kit the player may use opens its layout editor. */
  private void layoutClick(Player player, KitMenu menu, int slot) {
    var kit = menu.kitAt(slot).flatMap(KitBook::byId);
    if (kit.isEmpty()) {
      return;
    }
    var locked =
        menus
            .armory()
            .access(player.getUniqueId())
            .map(access -> access.lock(kit.orElseThrow()).isPresent())
            .orElse(true);
    if (locked) {
      Texts.error(player, "Buy " + kit.orElseThrow().name() + " to set its layout.");
      return;
    }
    later(() -> menus.editLayout(player, kit.orElseThrow()));
  }

  private void purchaseClick(Player player, KitPurchaseMenu menu, int slot) {
    if (slot == KitPurchaseMenu.CONFIRM) {
      later(() -> KitMenu.close(player));
      menus.buy(player, menu.kit(), bought -> runner.picker().browse(player, 0));
    } else if (slot == KitPurchaseMenu.CANCEL) {
      later(() -> runner.picker().browse(player, 0));
    }
  }

  /** Runs {@code work} next tick: a menu may not be closed or swapped inside its own click. */
  private void later(Runnable work) {
    context.scheduler().runOnMainThread(work);
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void onDrag(InventoryDragEvent event) {
    if (menu(event.getView())) {
      event.setCancelled(true);
    }
  }
}
