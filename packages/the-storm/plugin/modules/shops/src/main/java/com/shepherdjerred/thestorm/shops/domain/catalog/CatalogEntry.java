package com.shepherdjerred.thestorm.shops.domain.catalog;

import com.shepherdjerred.thestorm.shops.domain.price.Price;
import com.shepherdjerred.thestorm.shops.domain.price.PriceRules;
import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import java.util.Locale;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.regex.Pattern;

/**
 * One line of a catalog. Absent sides and limits are written explicitly as {@code null} in YAML.
 *
 * @param item the item's key, such as {@code coal} or {@code minecraft:coal}
 * @param quantity items per trade
 * @param buy what a customer pays per trade, or {@code null} if the shop does not sell it
 * @param sell what a customer is paid per trade, or {@code null} if the shop does not buy it
 * @param dailyLimit how many items a player may buy, and separately sell, per day; {@code null} for
 *     no limit
 */
public record CatalogEntry(
    String item, int quantity, Optional<Long> buy, Optional<Long> sell, OptionalInt dailyLimit) {

  /** The most items one catalog trade may move: a full player inventory of 64-stacks. */
  public static final int MAX_QUANTITY = 36 * 64;

  private static final Pattern ITEM_KEY = Pattern.compile("(?:minecraft:)?[a-z0-9_]+");

  public CatalogEntry {
    if (!ITEM_KEY.matcher(item).matches()) {
      throw new IllegalArgumentException(
          "item must be a lowercase item key like coal or minecraft:coal, not \"" + item + "\"");
    }
    if (quantity < 1 || quantity > MAX_QUANTITY) {
      throw new IllegalArgumentException("quantity must be 1.." + MAX_QUANTITY + ": " + quantity);
    }
    buy.ifPresent(CatalogEntry::requirePrice);
    sell.ifPresent(CatalogEntry::requirePrice);
    var problems = PriceRules.standard().check(buy.map(Price::of), sell.map(Price::of));
    if (!problems.isEmpty()) {
      throw new IllegalArgumentException(problems.getFirst().describe());
    }
    if (dailyLimit.isPresent() && dailyLimit.getAsInt() < quantity) {
      throw new IllegalArgumentException(
          "dailyLimit ("
              + dailyLimit.getAsInt()
              + ") must allow at least one trade of "
              + quantity);
    }
  }

  /** The item key without its namespace: {@code coal}. */
  public String itemKey() {
    return keyOf(item);
  }

  public ShopPrices prices() {
    return pricesOf(buy, sell);
  }

  /** {@code minecraft:coal} and {@code coal} are the same item. */
  public static String keyOf(String item) {
    var key = item.startsWith("minecraft:") ? item.substring("minecraft:".length()) : item;
    return key.toLowerCase(Locale.ROOT);
  }

  private static ShopPrices pricesOf(Optional<Long> buy, Optional<Long> sell) {
    return new ShopPrices(buy.map(Price::of), sell.map(Price::of));
  }

  private static void requirePrice(long crystals) {
    if (crystals < 1 || crystals > Price.MAX) {
      throw new IllegalArgumentException(
          "prices must be 1.." + Price.MAX + " crystals: " + crystals);
    }
  }
}
