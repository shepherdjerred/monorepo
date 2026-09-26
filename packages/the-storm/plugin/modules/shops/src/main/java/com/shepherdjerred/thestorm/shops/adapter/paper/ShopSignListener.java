package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.shops.app.ChestShops;
import com.shepherdjerred.thestorm.shops.app.Customer;
import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import com.shepherdjerred.thestorm.shops.domain.config.ChestShopSettings;
import com.shepherdjerred.thestorm.shops.domain.shop.CreationProblem;
import com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import com.shepherdjerred.thestorm.shops.domain.sign.ItemLine;
import com.shepherdjerred.thestorm.shops.domain.sign.ShopSignDraft;
import com.shepherdjerred.thestorm.shops.domain.sign.ShopSignParser;
import com.shepherdjerred.thestorm.shops.domain.sign.SignLines;
import com.shepherdjerred.thestorm.shops.domain.sign.SignProblem;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.block.Block;
import org.bukkit.block.sign.Side;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.SignChangeEvent;

/**
 * Turns a sign written in the shop format into a shop. The owner line is filled in with the
 * creator's name; the other lines are rewritten in the canonical format. Creating a chest shop
 * needs Shopkeeper I, the right to build at the sign and to open the container, and room under the
 * creator's shop limit.
 */
final class ShopSignListener implements Listener {

  private final ShopSignParser parser;
  private final String adminShopLabel;
  private final ChestShops shops;
  private final ShopRegistry registry;
  private final ShopBlocks blocks;
  private final ItemTemplates templates;
  private final Protection protection;
  private final Scheduler scheduler;
  private final String clicks;

  record Deps(
      ShopSignParser parser,
      String adminShopLabel,
      ChestShops shops,
      ShopRegistry registry,
      ShopBlocks blocks,
      ItemTemplates templates,
      Protection protection,
      Scheduler scheduler,
      ChestShopSettings.Click buyClick) {}

  ShopSignListener(Deps deps) {
    this.parser = deps.parser();
    this.adminShopLabel = deps.adminShopLabel();
    this.shops = deps.shops();
    this.registry = deps.registry();
    this.blocks = deps.blocks();
    this.templates = deps.templates();
    this.protection = deps.protection();
    this.scheduler = deps.scheduler();
    this.clicks =
        switch (deps.buyClick()) {
          case LEFT -> "left-click to buy and right-click to sell";
          case RIGHT -> "right-click to buy and left-click to sell";
        };
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void onSignChange(SignChangeEvent event) {
    var block = event.getBlock();
    var player = event.getPlayer();
    if (registry.atSign(ShopBlocks.pos(block)).isPresent()) {
      event.setCancelled(true);
      player.sendMessage(
          Replies.error("Shop signs cannot be edited; break it and make a new one."));
      return;
    }
    if (event.getSide() != Side.FRONT) {
      return;
    }
    var lines =
        new SignLines(
            event.lines().stream()
                .map(line -> PlainTextComponentSerializer.plainText().serialize(line))
                .toList());
    if (!parser.looksLikeShop(lines)) {
      return;
    }
    var created = create(player, block, lines);
    if (created.isEmpty()) {
      event.setCancelled(true);
      return;
    }
    var shop = created.orElseThrow();
    var shown = shop.lines(adminShopLabel);
    for (var index = 0; index < shown.lines().size(); index++) {
      event.line(index, Component.text(shown.lines().get(index)));
    }
    // The server writes the event's lines after this handler; stamp the id once they are in place.
    // A sign broken within that tick takes its shop with it.
    scheduler.runOnMainThread(
        () -> {
          if (registry.byId(shop.id()).isPresent() && !blocks.stamp(block, shop)) {
            shops.remove(shop);
          }
        });
    player.sendMessage(Replies.success(created(shop)));
  }

  private Optional<SignShop> create(Player player, Block block, SignLines lines) {
    return switch (parser.parse(lines)) {
      case Result.Err<ShopSignDraft, List<SignProblem>>(var problems) -> refuse(player, problems);
      case Result.Ok<ShopSignDraft, List<SignProblem>>(var draft) ->
          switch (item(draft.item())) {
            case Result.Err<Optional<ItemFingerprint>, SignProblem>(var problem) ->
                refuse(player, List.of(problem));
            case Result.Ok<Optional<ItemFingerprint>, SignProblem>(var item) ->
                create(player, block, draft, item);
          };
    };
  }

  private Optional<SignShop> create(
      Player player, Block block, ShopSignDraft draft, Optional<ItemFingerprint> item) {
    var container = ShopBlocks.supportOf(block).filter(blocks::isShopContainer);
    if (!allowedToBuild(player, block, container)) {
      return Optional.empty();
    }
    var request =
        new ChestShops.Request(
            draft,
            new Customer(player.getUniqueId(), player.getName()),
            player.hasPermission(ShopsPermissions.ADMIN),
            ShopsPermissions.shopkeeperLevel(player),
            new ChestShops.Placement(
                ShopBlocks.pos(block),
                container.map(ShopBlocks::pos),
                container.map(ShopBlocks::containerBlocks).orElseGet(List::of)),
            item);
    return switch (shops.create(request)) {
      case Result.Ok<SignShop, List<CreationProblem>>(var shop) -> Optional.of(shop);
      case Result.Err<SignShop, List<CreationProblem>>(var problems) -> {
        problems.forEach(problem -> player.sendMessage(Replies.error(problem.describe())));
        yield Optional.empty();
      }
    };
  }

  private static Optional<SignShop> refuse(Player player, List<SignProblem> problems) {
    problems.forEach(problem -> player.sendMessage(Replies.error(problem.describe())));
    return Optional.empty();
  }

  /** The item the sign names, or empty for {@code ?}. */
  private Result<Optional<ItemFingerprint>, SignProblem> item(ItemLine line) {
    return switch (line) {
      case ItemLine.Pending() -> Result.ok(Optional.empty());
      case ItemLine.Named(var name) ->
          ItemTemplates.item(name)
              .<Result<Optional<ItemFingerprint>, SignProblem>>map(
                  material -> Result.ok(Optional.of(templates.plain(material))))
              .orElseGet(() -> Result.err(new SignProblem.UnknownItem(name)));
    };
  }

  private boolean allowedToBuild(Player player, Block sign, Optional<Block> container) {
    var checks = new ArrayList<Decision>(2);
    checks.add(protection.check(player.getUniqueId(), ProtectedAction.BUILD, sign.getLocation()));
    container.ifPresent(
        block ->
            checks.add(
                protection.check(
                    player.getUniqueId(), ProtectedAction.OPEN_CONTAINER, block.getLocation())));
    for (var decision : checks) {
      if (decision instanceof Decision.Denied(var reason)) {
        player.sendMessage(HouseStyle.error(Replies.LABEL, reason));
        return false;
      }
    }
    return true;
  }

  private String created(SignShop shop) {
    return shop.item().isPresent()
        ? "Shop open. Customers " + clicks + "."
        : "Shop made. Right-click the sign holding the item it should trade.";
  }
}
