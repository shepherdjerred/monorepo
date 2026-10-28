package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.core.towns.TownDirectory;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Money;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.shops.app.ChestShops;
import com.shepherdjerred.thestorm.shops.app.Customer;
import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import com.shepherdjerred.thestorm.shops.domain.config.ChestShopSettings;
import com.shepherdjerred.thestorm.shops.domain.shop.CreationProblem;
import com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import com.shepherdjerred.thestorm.shops.domain.sign.ItemLine;
import com.shepherdjerred.thestorm.shops.domain.sign.OwnerLine;
import com.shepherdjerred.thestorm.shops.domain.sign.ShopSignDraft;
import com.shepherdjerred.thestorm.shops.domain.sign.ShopSignParser;
import com.shepherdjerred.thestorm.shops.domain.sign.SignLines;
import com.shepherdjerred.thestorm.shops.domain.sign.SignProblem;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.SignChangeEvent;
import org.jspecify.annotations.Nullable;

/**
 * Turns a sign written in the shop format into a shop. A blank owner line is filled in with the
 * creator's name; a player or town name stays that owner when the creator may make a shop for them.
 * Creating a chest shop needs Shopkeeper I, the right to build at the sign and to open the
 * container, and room under the owner's shop limit.
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
  private final ChestShopSettings settings;
  private final Wallets wallets;
  private final Services services;
  private final String clicks;
  private final IdentityHashMap<SignChangeEvent, SignShop> pending = new IdentityHashMap<>();

  record Deps(
      ShopSignParser parser,
      String adminShopLabel,
      ChestShops shops,
      ShopRegistry registry,
      ShopBlocks blocks,
      ItemTemplates templates,
      Protection protection,
      Scheduler scheduler,
      ChestShopSettings.Click buyClick,
      ChestShopSettings settings,
      Wallets wallets,
      Services services) {}

  ShopSignListener(Deps deps) {
    this.parser = deps.parser();
    this.adminShopLabel = deps.adminShopLabel();
    this.shops = deps.shops();
    this.registry = deps.registry();
    this.blocks = deps.blocks();
    this.templates = deps.templates();
    this.protection = deps.protection();
    this.scheduler = deps.scheduler();
    this.settings = deps.settings();
    this.wallets = deps.wallets();
    this.services = deps.services();
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
    registry
        .atSign(ShopBlocks.pos(block))
        .ifPresent(
            existing -> {
              if (blocks.shopAtSign(block).isPresent()) {
                event.setCancelled(true);
                player.sendMessage(
                    Replies.error("Shop signs cannot be edited; break it and make a new one."));
              } else {
                shops.remove(existing);
              }
            });
    if (event.isCancelled()) {
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
    if (settings.shopsDisabledIn(block.getWorld().getName())) {
      event.setCancelled(true);
      player.sendMessage(Replies.error("Shops are not used in this world."));
      return;
    }
    switch (create(player, block, lines)) {
      case Outcome.Refused() -> {
        event.setCancelled(true);
        return;
      }
      case Outcome.Later() -> {
        return;
      }
      case Outcome.Ready(var shop) -> pending(event, shop);
    }
  }

  private void pending(SignChangeEvent event, SignShop shop) {
    var shown = shop.lines(adminShopLabel);
    for (var index = 0; index < shown.lines().size(); index++) {
      event.line(index, Component.text(shown.lines().get(index)));
    }
    pending.put(event, shop);
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void commitSignChange(SignChangeEvent event) {
    var shop = pending.remove(event);
    if (shop == null || event.isCancelled()) {
      return;
    }
    shops.activate(shop);
    chargeFee(event.getPlayer(), shop, event.getBlock());
    var block = event.getBlock();
    // The server writes the event's lines after this handler; stamp the id once they are in place.
    // A sign broken within that tick takes its shop with it.
    scheduler.runOnMainThread(
        () -> {
          if (registry.byId(shop.id()).isPresent() && !blocks.stamp(block, shop)) {
            shops.remove(shop);
          }
        });
    event.getPlayer().sendMessage(Replies.success(created(shop)));
  }

  private sealed interface Outcome {
    record Ready(SignShop shop) implements Outcome {}

    /** The owner is looked up off the tick; the sign stays until that answers. */
    record Later() implements Outcome {}

    record Refused() implements Outcome {}
  }

  private Outcome create(Player player, Block block, SignLines lines) {
    return switch (parser.parse(lines)) {
      case Result.Err<ShopSignDraft, List<SignProblem>>(var problems) -> refuse(player, problems);
      case Result.Ok<ShopSignDraft, List<SignProblem>>(var draft) ->
          switch (item(draft.item())) {
            case Result.Err<Optional<ItemFingerprint>, SignProblem>(var problem) ->
                refuse(player, List.of(problem));
            case Result.Ok<Optional<ItemFingerprint>, SignProblem>(var item) -> {
              var material = item.map(ItemFingerprint::material).orElse("");
              if (!player.hasPermission(ShopsPermissions.PRICE_BYPASS)) {
                var prices = bandProblems(draft, material);
                if (!prices.isEmpty()) {
                  yield refuse(player, prices);
                }
              }
              if (!ShopMaterialAccess.may(player, "create", material)) {
                player.sendMessage(Replies.error("You cannot make a shop for that item."));
                yield new Outcome.Refused();
              }
              yield create(player, block, draft, item);
            }
          };
    };
  }

  private record Attempt(
      Player player, Block block, ShopSignDraft draft, Optional<ItemFingerprint> item) {}

  private Outcome create(
      Player player, Block block, ShopSignDraft draft, Optional<ItemFingerprint> item) {
    var attempt = new Attempt(player, block, draft, item);
    return switch (draft.owner()) {
      case OwnerLine.Creator() ->
          ready(attempt, new ShopOwner.Player(player.getUniqueId(), player.getName()));
      case OwnerLine.AdminShop() -> ready(attempt, new ShopOwner.Admin());
      case OwnerLine.Named(var name) -> named(attempt, name);
    };
  }

  private Outcome named(Attempt attempt, String name) {
    var player = attempt.player();
    var block = attempt.block();
    if (player.getName().equalsIgnoreCase(name)) {
      return ready(attempt, new ShopOwner.Player(player.getUniqueId(), player.getName()));
    }
    if (!ShopNameAccess.may(player, "create", name)) {
      player.sendMessage(Replies.error("You cannot make a shop for " + name + "."));
      return new Outcome.Refused();
    }
    var online = online(player, name);
    if (online != null) {
      return ready(attempt, new ShopOwner.Player(online.getUniqueId(), online.getName()));
    }
    var directory = services.find(PlayerDirectory.class);
    if (directory.isEmpty()) {
      return townOrRefuse(attempt, name);
    }
    var lookup = directory.orElseThrow().byName(name);
    var _ =
        lookup.whenComplete(
            (found, error) ->
                scheduler.runOnMainThread(
                    () -> {
                      if (error != null || found == null || found.isEmpty()) {
                        finishLater(player, block, townOrRefuse(attempt, name));
                        return;
                      }
                      var known = found.orElseThrow();
                      finishLater(
                          player,
                          block,
                          ready(attempt, new ShopOwner.Player(known.uuid(), known.lastName())));
                    }));
    return new Outcome.Later();
  }

  private Outcome townOrRefuse(Attempt attempt, String name) {
    var player = attempt.player();
    var town = services.find(TownDirectory.class).flatMap(directory -> directory.named(name));
    if (town.isEmpty()) {
      player.sendMessage(
          Replies.error("Nobody named " + name + " has played here, and no town has that name."));
      return new Outcome.Refused();
    }
    var found = town.orElseThrow();
    return ready(attempt, new ShopOwner.Town(found.id(), found.name()));
  }

  private Outcome ready(Attempt attempt, ShopOwner owner) {
    var shop = prepare(attempt, owner);
    return shop.<Outcome>map(Outcome.Ready::new).orElseGet(Outcome.Refused::new);
  }

  private void finishLater(Player player, Block block, Outcome outcome) {
    switch (outcome) {
      case Outcome.Ready(var shop) -> publish(player, block, shop);
      case Outcome.Refused() -> {
        if (block.getState() instanceof Sign) {
          block.breakNaturally();
        }
      }
      case Outcome.Later() -> {}
    }
  }

  private void publish(Player player, Block block, SignShop shop) {
    shops.activate(shop);
    chargeFee(player, shop, block);
    if (block.getState() instanceof Sign sign) {
      var shown = shop.lines(adminShopLabel);
      var side = sign.getSide(Side.FRONT);
      for (var index = 0; index < shown.lines().size(); index++) {
        side.line(index, Component.text(shown.lines().get(index)));
      }
      sign.update();
    }
    scheduler.runOnMainThread(
        () -> {
          if (registry.byId(shop.id()).isPresent() && !blocks.stamp(block, shop)) {
            shops.remove(shop);
          }
        });
    player.sendMessage(Replies.success(created(shop)));
  }

  private static @Nullable Player online(Player player, String name) {
    for (var online : player.getServer().getOnlinePlayers()) {
      if (online.getName().equalsIgnoreCase(name)) {
        return online;
      }
    }
    return null;
  }

  private Optional<SignShop> prepare(Attempt attempt, ShopOwner owner) {
    var player = attempt.player();
    var block = attempt.block();
    var draft = attempt.draft();
    var item = attempt.item();
    var container = ShopBlocks.supportOf(block).filter(blocks::isShopContainer);
    if (!allowedToBuild(player, block, container)) {
      return Optional.empty();
    }
    var request =
        new ChestShops.Request(
            draft,
            new Customer(player.getUniqueId(), player.getName()),
            player.hasPermission(ShopsPermissions.ADMIN),
            levelFor(player, owner),
            new ChestShops.Placement(
                ShopBlocks.pos(block),
                container.map(ShopBlocks::pos),
                container.map(ShopBlocks::containerBlocks).orElseGet(List::of)),
            item,
            owner);
    return switch (shops.prepare(request)) {
      case Result.Ok<SignShop, List<CreationProblem>>(var shop) -> Optional.of(shop);
      case Result.Err<SignShop, List<CreationProblem>>(var problems) -> {
        problems.forEach(problem -> player.sendMessage(Replies.error(problem.describe())));
        yield Optional.empty();
      }
    };
  }

  private List<SignProblem> bandProblems(ShopSignDraft draft, String material) {
    var problems = new ArrayList<SignProblem>();
    for (var side : Direction.values()) {
      draft
          .prices()
          .forDirection(side)
          .flatMap(price -> settings.prices().check(side, price.crystals(), material))
          .ifPresent(
              violation ->
                  problems.add(
                      new SignProblem.PriceOutOfBand(
                          violation.side(), violation.price(), violation.min(), violation.max())));
    }
    return problems;
  }

  private void chargeFee(Player player, SignShop shop, Block block) {
    if (settings.creationFee() == 0
        || player.hasPermission(ShopsPermissions.SKIP_FEE)
        || shop.isAdmin()) {
      return;
    }
    var amount = Money.crystals(settings.creationFee());
    var _ =
        wallets
            .transfer(
                new AccountId.Player(player.getUniqueId()),
                new AccountId.Server(),
                amount,
                "shop:create:" + shop.id())
            .whenComplete(
                (result, error) ->
                    scheduler.runOnMainThread(
                        () -> {
                          if (error == null && result instanceof Result.Ok) {
                            return;
                          }
                          shops.remove(shop);
                          block.breakNaturally();
                          player.sendMessage(
                              Replies.error(
                                  "Opening a shop costs "
                                      + settings.creationFee()
                                      + " crystals. The sign was removed."));
                        }));
  }

  private int levelFor(Player creator, ShopOwner owner) {
    var yours = ShopsPermissions.shopkeeperLevel(creator);
    return switch (owner) {
      case ShopOwner.Admin() -> 0;
      case ShopOwner.Town(_, _) -> yours;
      case ShopOwner.Player(var id, _) -> {
        var online = online(creator, id);
        var theirs = online == null ? 0 : ShopsPermissions.shopkeeperLevel(online);
        yield theirs > 0 ? theirs : yours;
      }
    };
  }

  private static @Nullable Player online(Player creator, java.util.UUID id) {
    for (var online : creator.getServer().getOnlinePlayers()) {
      if (online.getUniqueId().equals(id)) {
        return online;
      }
    }
    return null;
  }

  private static Outcome refuse(Player player, List<SignProblem> problems) {
    problems.forEach(problem -> player.sendMessage(Replies.error(problem.describe())));
    return new Outcome.Refused();
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
    var checks = new ArrayList<Decision>(3);
    checks.add(protection.check(player.getUniqueId(), ProtectedAction.BUILD, sign.getLocation()));
    container.stream()
        .flatMap(block -> ShopBlocks.containerBlocks(block).stream())
        .map(pos -> blocks.block(pos).orElseThrow())
        .forEach(
            block ->
                checks.add(
                    protection.check(
                        player.getUniqueId(),
                        ProtectedAction.OPEN_CONTAINER,
                        block.getLocation())));
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
