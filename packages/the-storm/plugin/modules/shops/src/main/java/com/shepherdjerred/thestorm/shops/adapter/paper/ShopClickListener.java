package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.shops.app.ChestShops;
import com.shepherdjerred.thestorm.shops.app.Customer;
import com.shepherdjerred.thestorm.shops.app.Holdings;
import com.shepherdjerred.thestorm.shops.app.ShopTexts;
import com.shepherdjerred.thestorm.shops.domain.config.ChestShopSettings;
import com.shepherdjerred.thestorm.shops.domain.shop.CreationProblem;
import com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import com.shepherdjerred.thestorm.shops.domain.sign.ItemNames;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeProblem;
import java.util.List;
import java.util.Optional;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;

/**
 * Clicks on shop signs. Customers buy with one click and sell with the other; the owner sets a
 * {@code ?} shop's item by right-clicking with it, checks stock with a right-click, and breaks the
 * sign with a left-click. Shop signs never open the sign editor.
 */
final class ShopClickListener implements Listener {

  private final ChestShopSettings settings;
  private final ChestShops shops;
  private final ShopBlocks blocks;
  private final ItemTemplates templates;
  private final Replies replies;

  ShopClickListener(ChestShopSettings settings, ChestShops shops, PaperTools tools) {
    this.settings = settings;
    this.shops = shops;
    this.blocks = tools.blocks();
    this.templates = tools.templates();
    this.replies = tools.replies();
  }

  @EventHandler(priority = EventPriority.HIGH)
  public void onClick(PlayerInteractEvent event) {
    var click = click(event.getAction());
    var block = event.getClickedBlock();
    if (click.isEmpty() || block == null || event.getHand() != EquipmentSlot.HAND) {
      return;
    }
    var shop = blocks.shopAtSign(block);
    if (shop.isEmpty()) {
      return;
    }
    var player = event.getPlayer();
    if (manages(player, shop.orElseThrow())) {
      if (click.orElseThrow() == ChestShopSettings.Click.RIGHT) {
        event.setCancelled(true);
        ownerClick(player, block, shop.orElseThrow());
      }
      return;
    }
    if (click.orElseThrow() == ChestShopSettings.Click.LEFT
        && player.isSneaking()
        && player.hasPermission(ShopsPaper.ADMIN_PERMISSION)) {
      return;
    }
    event.setCancelled(true);
    trade(player, shop.orElseThrow(), settings.directionOf(click.orElseThrow()));
  }

  /**
   * The owner of a chest shop; for an admin shop, any admin until its item is set (after that,
   * admins trade there like everyone else).
   */
  private static boolean manages(Player player, SignShop shop) {
    return shop.owner().isOwnedBy(player.getUniqueId())
        || (shop.isAdmin()
            && shop.item().isEmpty()
            && player.hasPermission(ShopsPaper.ADMIN_PERMISSION));
  }

  private void ownerClick(Player player, Block block, SignShop shop) {
    if (shop.item().isEmpty()) {
      var hand = player.getInventory().getItemInMainHand();
      if (hand.getType().isAir()) {
        player.sendMessage(Replies.info("Right-click the sign holding the item this shop trades."));
        return;
      }
      switch (shops.setItem(shop, templates.fingerprint(hand))) {
        case Result.Ok<SignShop, CreationProblem>(var updated) -> {
          blocks.rewrite(block, updated, updated.lines(settings.adminShopLabel()));
          player.sendMessage(
              Replies.success("This shop now trades " + name(updated.item().orElseThrow()) + "."));
        }
        case Result.Err<SignShop, CreationProblem>(var problem) ->
            player.sendMessage(Replies.error(problem.describe()));
      }
      return;
    }
    var item = shop.item().orElseThrow();
    var stock = containerHoldings(shop, item).stockpile();
    player.sendMessage(
        Replies.info(
            "Your shop holds "
                + stock.count()
                + " "
                + name(item)
                + " with room for "
                + stock.space()
                + " more."));
  }

  private void trade(Player player, SignShop shop, Direction direction) {
    if (shop.item().isEmpty()) {
      player.sendMessage(
          Replies.error(replies.texts().problem(new TradeProblem.ItemNotSet(), "items")));
      return;
    }
    var item = shop.item().orElseThrow();
    var visit =
        new ChestShops.Visit(
            shop,
            direction,
            new Customer(player.getUniqueId(), player.getName()),
            InventoryHoldings.ofPlayer(
                player.getServer(),
                player.getUniqueId(),
                templates.template(item),
                ShopBlocks.locationOf(player)),
            shop.isAdmin() ? Holdings.UNLIMITED : containerHoldings(shop, item),
            shop.container()
                .flatMap(blocks::block)
                .map(ShopBlocks::containerBlocks)
                .orElseGet(List::of));
    var goods = ShopTexts.goods(shop.quantity(), item.material());
    replies.whenDone(
        shops.trade(visit),
        player.getUniqueId(),
        outcome ->
            replies.outcome(
                player,
                outcome,
                name(item),
                paid -> replies.texts().completed(direction, goods, paid, shopName(shop))));
  }

  private Holdings containerHoldings(SignShop shop, ItemFingerprint item) {
    var container = shop.container().orElseThrow();
    return InventoryHoldings.of(
        () -> blocks.block(container).flatMap(ShopBlocks::inventoryOf),
        templates.template(item),
        () -> blocks.center(container));
  }

  private String shopName(SignShop shop) {
    return switch (shop.owner()) {
      case ShopOwner.Player(_, var name) -> name + "'s shop";
      case ShopOwner.Admin() -> "the " + settings.adminShopLabel();
    };
  }

  private static String name(ItemFingerprint item) {
    return ItemNames.pretty(item.material()) + (item.special() ? ItemNames.SPECIAL_MARK : "");
  }

  private static Optional<ChestShopSettings.Click> click(Action action) {
    return switch (action) {
      case LEFT_CLICK_BLOCK -> Optional.of(ChestShopSettings.Click.LEFT);
      case RIGHT_CLICK_BLOCK -> Optional.of(ChestShopSettings.Click.RIGHT);
      case LEFT_CLICK_AIR, RIGHT_CLICK_AIR, PHYSICAL -> Optional.empty();
    };
  }
}
