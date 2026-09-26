package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.shops.app.CatalogTrades;
import com.shepherdjerred.thestorm.shops.app.Customer;
import com.shepherdjerred.thestorm.shops.app.ServerShops;
import com.shepherdjerred.thestorm.shops.app.ShopTexts;
import com.shepherdjerred.thestorm.shops.domain.catalog.Catalog;
import com.shepherdjerred.thestorm.shops.domain.catalog.CatalogEntry;
import com.shepherdjerred.thestorm.shops.domain.sign.ItemNames;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import io.papermc.paper.dialog.Dialog;
import io.papermc.paper.dialog.DialogResponseView;
import io.papermc.paper.registry.data.dialog.ActionButton;
import io.papermc.paper.registry.data.dialog.DialogBase;
import io.papermc.paper.registry.data.dialog.action.DialogAction;
import io.papermc.paper.registry.data.dialog.body.DialogBody;
import io.papermc.paper.registry.data.dialog.input.DialogInput;
import io.papermc.paper.registry.data.dialog.type.DialogType;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.Set;
import java.util.function.Consumer;
import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickCallback;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

/**
 * The NPC shops as Paper dialogs. A catalog opens as a list of buttons, one per item with its
 * prices; an item opens a second dialog with a quantity slider and Buy/Sell buttons. Every button
 * checks that the player is still within reach of where the shop was opened (the shopkeeper NPC),
 * so a dialog left open cannot be used from across the map.
 *
 * <p>Dialogs rather than a chest menu: a dialog cannot leak items the way a chest menu can (no
 * shift-clicks, drags or number keys to cancel), it can ask for a quantity, and Geyser turns it
 * into a native Bedrock form (buttons become a simple form; the slider and buttons a custom form).
 * The item icon is the one thing Bedrock drops, so every button and body also names the item in
 * text.
 */
final class DialogServerShops implements ServerShops {

  private static final ClickCallback.Options ONCE =
      ClickCallback.Options.builder().uses(1).lifetime(Duration.ofMinutes(10)).build();
  private static final String LOTS = "lots";
  private static final int BUTTON_WIDTH = 150;

  private final CatalogTrades trades;
  private final Replies replies;
  private final Scheduler scheduler;
  private final int maxDistance;

  /**
   * @param maxDistance how far, in blocks, a player may be from where the shop was opened
   */
  DialogServerShops(CatalogTrades trades, Replies replies, Scheduler scheduler, int maxDistance) {
    this.trades = trades;
    this.replies = replies;
    this.scheduler = scheduler;
    this.maxDistance = maxDistance;
  }

  /**
   * A catalog opened at a place.
   *
   * @param catalog the catalog
   * @param at where it was opened: the shopkeeper, or the player for {@code /shop}
   */
  private record Visit(Catalog catalog, Location at) {}

  @Override
  public void open(Player player, String catalogId) {
    open(player, catalogId, ShopBlocks.locationOf(player));
  }

  @Override
  public void open(Player player, String catalogId, Location shopkeeper) {
    var catalog =
        trades
            .catalog(catalogId)
            .orElseThrow(() -> new IllegalArgumentException("No shop catalog " + catalogId));
    player.showDialog(menu(new Visit(catalog, shopkeeper.clone())));
  }

  @Override
  public boolean has(String catalogId) {
    return trades.catalog(catalogId).isPresent();
  }

  @Override
  public Set<String> catalogIds() {
    return trades.ids();
  }

  private Dialog menu(Visit visit) {
    var catalog = visit.catalog();
    var buttons =
        catalog.entries().stream()
            .map(
                entry ->
                    ActionButton.builder(Component.text(ShopTexts.entryLabel(entry)))
                        .tooltip(Component.text(replies.texts().entryPrices(entry)))
                        .width(BUTTON_WIDTH)
                        .action(onClick(visit, player -> showEntry(player, visit, entry)))
                        .build())
            .toList();
    return Dialog.create(
        factory ->
            factory
                .empty()
                .base(
                    DialogBase.builder(Component.text(catalog.name()))
                        .canCloseWithEscape(true)
                        .body(List.of(DialogBody.plainMessage(Component.text(catalog.greeting()))))
                        .build())
                .type(
                    DialogType.multiAction(buttons)
                        .columns(2)
                        .exitAction(ActionButton.builder(Component.text("Close")).build())
                        .build()));
  }

  /** Looks up today's allowances, then shows the item's dialog. */
  private void showEntry(Player player, Visit visit, CatalogEntry entry) {
    var customer = customer(player);
    var buyLeft = trades.remainingToday(visit.catalog(), entry, Direction.BUY, customer);
    var sellLeft = trades.remainingToday(visit.catalog(), entry, Direction.SELL, customer);
    replies.whenDone(
        buyLeft.thenCombine(sellLeft, Allowances::new),
        player.getUniqueId(),
        allowances -> {
          if (player.isOnline()) {
            player.showDialog(entryDialog(visit, entry, allowances));
          }
        });
  }

  private record Allowances(OptionalInt buy, OptionalInt sell) {}

  private Dialog entryDialog(Visit visit, CatalogEntry entry, Allowances allowances) {
    var material = material(entry);
    var name = ItemNames.pretty(entry.itemKey());
    var body = new ArrayList<DialogBody>();
    body.add(
        DialogBody.item(
                ItemStack.of(material, Math.min(entry.quantity(), material.getMaxStackSize())))
            .description(DialogBody.plainMessage(Component.text(ShopTexts.entryLabel(entry))))
            .build());
    body.add(DialogBody.plainMessage(Component.text(details(entry, allowances))));
    var inputs = new ArrayList<DialogInput>();
    if (trades.maxLots() > 1) {
      inputs.add(
          DialogInput.numberRange(
                  LOTS,
                  Component.text("Trades of " + entry.quantity() + " " + name),
                  1,
                  trades.maxLots())
              .step(1f)
              .initial(1f)
              .build());
    }
    var buttons = new ArrayList<ActionButton>(2);
    entry.buy().ifPresent(price -> buttons.add(tradeButton(visit, entry, Direction.BUY)));
    entry.sell().ifPresent(price -> buttons.add(tradeButton(visit, entry, Direction.SELL)));
    return Dialog.create(
        factory ->
            factory
                .empty()
                .base(
                    DialogBase.builder(Component.text(visit.catalog().name() + ": " + name))
                        .canCloseWithEscape(true)
                        .body(body)
                        .inputs(inputs)
                        .build())
                .type(
                    DialogType.multiAction(buttons)
                        .columns(buttons.size())
                        .exitAction(
                            ActionButton.builder(Component.text("Back"))
                                .action(onClick(visit, player -> player.showDialog(menu(visit))))
                                .build())
                        .build()));
  }

  private String details(CatalogEntry entry, Allowances allowances) {
    var lines = new ArrayList<String>();
    lines.add(replies.texts().entryPrices(entry) + " for " + ShopTexts.entryLabel(entry) + ".");
    if (entry.buy().isPresent()) {
      allowances.buy().ifPresent(left -> lines.add("You can buy " + left + " more today."));
    }
    if (entry.sell().isPresent()) {
      allowances.sell().ifPresent(left -> lines.add("You can sell " + left + " more today."));
    }
    return String.join("\n", lines);
  }

  private ActionButton tradeButton(Visit visit, CatalogEntry entry, Direction direction) {
    var label =
        switch (direction) {
          case BUY -> "Buy";
          case SELL -> "Sell";
        };
    var price = entry.prices().forDirection(direction).orElseThrow().crystals();
    return ActionButton.builder(Component.text(label))
        .tooltip(
            Component.text(
                label + " " + ShopTexts.entryLabel(entry) + " for " + replies.texts().words(price)))
        .action(
            DialogAction.customClick(
                (view, audience) ->
                    onPlayer(
                        audience,
                        visit,
                        player -> trade(player, new Pick(visit, entry), direction, lots(view))),
                ONCE))
        .build();
  }

  /** The slider's value, parsed once here: untrusted client input. */
  private Optional<Integer> lots(DialogResponseView view) {
    if (trades.maxLots() == 1) {
      return Optional.of(1);
    }
    var value = view.getFloat(LOTS);
    if (value == null || value.isNaN() || value < 1 || value > trades.maxLots()) {
      return Optional.empty();
    }
    return Optional.of(Math.round(value));
  }

  /**
   * One line of one catalog, opened at a place.
   *
   * @param visit the catalog and where it was opened
   * @param entry the line
   */
  private record Pick(Visit visit, CatalogEntry entry) {}

  private void trade(Player player, Pick pick, Direction direction, Optional<Integer> lots) {
    var catalog = pick.visit().catalog();
    var entry = pick.entry();
    if (lots.isEmpty()) {
      player.sendMessage(Replies.error("Choose between 1 and " + trades.maxLots() + " trades."));
      return;
    }
    var material = material(entry);
    var order =
        new CatalogTrades.Order(
            catalog,
            entry,
            direction,
            lots.orElseThrow(),
            customer(player),
            InventoryHoldings.ofPlayer(
                player.getServer(),
                player.getUniqueId(),
                ItemStack.of(material),
                ShopBlocks.locationOf(player)));
    var itemName = ItemNames.pretty(entry.itemKey());
    var goods = ShopTexts.goods(entry.quantity() * lots.orElseThrow(), entry.itemKey());
    replies.whenDone(
        trades.trade(order),
        player.getUniqueId(),
        outcome -> {
          replies.outcome(
              player,
              outcome,
              itemName,
              paid -> replies.texts().completed(direction, goods, paid, catalog.name()));
          if (player.isOnline() && near(player, pick.visit())) {
            showEntry(player, pick.visit(), entry);
          }
        });
  }

  /** A button action that runs once, on the main thread, for the player who clicked. */
  private DialogAction onClick(Visit visit, Consumer<Player> action) {
    return DialogAction.customClick((view, audience) -> onPlayer(audience, visit, action), ONCE);
  }

  /** Runs {@code action} on the main thread if the player is still near the shop. */
  private void onPlayer(Audience audience, Visit visit, Consumer<Player> action) {
    if (!(audience instanceof Player player)) {
      return;
    }
    scheduler.runOnMainThread(
        () -> {
          if (near(player, visit)) {
            action.accept(player);
          } else {
            player.sendMessage(
                Replies.error("You are too far from " + visit.catalog().name() + " to trade."));
          }
        });
  }

  private boolean near(Player player, Visit visit) {
    var at = ShopBlocks.locationOf(player);
    return player.isOnline()
        && Objects.equals(at.getWorld(), visit.at().getWorld())
        && at.distanceSquared(visit.at()) <= (double) maxDistance * maxDistance;
  }

  private static Customer customer(Player player) {
    return new Customer(player.getUniqueId(), player.getName());
  }

  private static Material material(CatalogEntry entry) {
    return ItemTemplates.item(entry.itemKey())
        .orElseThrow(
            () -> new IllegalStateException("validated item vanished: " + entry.itemKey()));
  }
}
