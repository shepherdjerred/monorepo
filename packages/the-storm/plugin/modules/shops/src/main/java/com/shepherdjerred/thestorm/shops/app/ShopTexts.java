package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.shops.domain.catalog.CatalogEntry;
import com.shepherdjerred.thestorm.shops.domain.sign.ItemNames;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import com.shepherdjerred.thestorm.shops.domain.trade.OwnerSummary;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeProblem;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeRecord;
import java.util.ArrayList;
import java.util.List;

/** The words shops say, with prices written the economy's way. */
public final class ShopTexts {

  private final CrystalFormatter crystals;

  public ShopTexts(CrystalFormatter crystals) {
    this.crystals = crystals;
  }

  /** {@code 16 Coal}. */
  public static String goods(int quantity, String material) {
    return quantity + " " + ItemNames.pretty(material);
  }

  public String words(long amount) {
    return crystals.words(Crystals.of(amount));
  }

  public String symbol(long amount) {
    return crystals.symbol(Crystals.of(amount));
  }

  /** To the customer after a completed trade. */
  public String completed(Direction direction, String goods, long price, String shopName) {
    return switch (direction) {
      case BUY -> "You bought " + goods + " from " + shopName + " for " + words(price) + ".";
      case SELL -> "You sold " + goods + " to " + shopName + " for " + words(price) + ".";
    };
  }

  /** To a chest shop's owner, on the spot. */
  public String ownerNotice(TradeRecord trade) {
    var goods = goods(trade.quantity(), trade.material());
    return switch (trade.direction()) {
      case BUY ->
          trade.customerName()
              + " bought "
              + goods
              + " from your shop for "
              + words(trade.price())
              + ".";
      case SELL ->
          trade.customerName()
              + " sold you "
              + goods
              + " at your shop for "
              + words(trade.price())
              + ".";
    };
  }

  /** To a chest shop's owner on join: what their shops did while they were away. */
  public List<String> summary(OwnerSummary summary) {
    var lines = new ArrayList<String>();
    lines.add(
        "While you were away, your shops made "
            + summary.trades()
            + (summary.trades() == 1 ? " trade" : " trades")
            + ": earned "
            + words(summary.earned())
            + ", spent "
            + words(summary.spent())
            + ".");
    for (var line : summary.lines()) {
      var goods = goods(line.quantity(), line.material());
      lines.add(
          switch (line.direction()) {
            case BUY -> "Sold " + goods + " for " + words(line.crystals()) + ".";
            case SELL -> "Bought " + goods + " for " + words(line.crystals()) + ".";
          });
    }
    if (summary.more() > 0) {
      lines.add("...and " + summary.more() + " more.");
    }
    return List.copyOf(lines);
  }

  /** Why a trade did not happen, for the customer. */
  public String problem(TradeProblem problem, String itemName) {
    return switch (problem) {
      case TradeProblem.NotOffered(var direction) ->
          switch (direction) {
            case BUY -> "This shop does not sell " + itemName + ".";
            case SELL -> "This shop does not buy " + itemName + ".";
          };
      case TradeProblem.ItemNotSet() -> "This shop is not open yet.";
      case TradeProblem.OwnShop() -> "You cannot trade with your own shop.";
      case TradeProblem.Busy() -> "Another trade is still going through; try again.";
      case TradeProblem.TooFast() -> "Slow down: one trade at a time.";
      case TradeProblem.ShopClosed(var why) -> "This shop is closed: " + why;
      case TradeProblem.OutOfStock(var available, var needed) ->
          "Out of stock: the shop has "
              + available
              + " "
              + itemName
              + " and a trade needs "
              + needed
              + ".";
      case TradeProblem.NoRoom(var space, var needed) ->
          "Your inventory has room for " + space + " " + itemName + ", not " + needed + ".";
      case TradeProblem.NotEnoughItems(var held, var needed) ->
          "You have " + held + " " + itemName + "; a trade needs " + needed + ".";
      case TradeProblem.ShopFull(var space, var needed) ->
          "The shop has room for " + space + " more " + itemName + ", not " + needed + ".";
      case TradeProblem.CustomerCannotPay(var balance, var required) ->
          "Not enough crystals: that costs "
              + words(required)
              + " and you have "
              + words(balance)
              + ".";
      case TradeProblem.OwnerCannotPay() -> "The shop's owner cannot afford to buy right now.";
      case TradeProblem.DailyLimitReached(var remaining, var requested) ->
          remaining == 0
              ? "You have traded all the " + itemName + " allowed today; come back tomorrow."
              : "You can trade "
                  + remaining
                  + " more "
                  + itemName
                  + " today, not "
                  + requested
                  + ".";
    };
  }

  /** To the customer when a paid trade was undone. */
  public String refunded(TradeProblem problem, String itemName) {
    return problem(problem, itemName) + " Your crystals were returned.";
  }

  /** To the customer when a paid trade was undone but the refund failed. */
  public String refundFailed(TradeProblem problem, String itemName) {
    return problem(problem, itemName)
        + " The refund did not go through; staff have been told and will put it right.";
  }

  /** A catalog entry's button in the shop menu: {@code 16 Coal}. */
  public static String entryLabel(CatalogEntry entry) {
    return goods(entry.quantity(), entry.itemKey());
  }

  /** A catalog entry's prices: {@code Buy 64 CR · Sell 16 CR}. */
  public String entryPrices(CatalogEntry entry) {
    var parts = new ArrayList<String>(2);
    entry.buy().ifPresent(price -> parts.add("Buy " + symbol(price)));
    entry.sell().ifPresent(price -> parts.add("Sell " + symbol(price)));
    return String.join(" · ", parts);
  }
}
