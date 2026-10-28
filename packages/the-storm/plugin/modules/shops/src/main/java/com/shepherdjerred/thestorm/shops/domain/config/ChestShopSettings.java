package com.shepherdjerred.thestorm.shops.domain.config;

import com.shepherdjerred.thestorm.shops.domain.price.PriceLimits;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopLimits;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Sign shops.
 *
 * @param buyClick which click on a shop sign buys; the other click sells
 * @param maxQuantity the most items one sign trade may move
 * @param adminShopLabel the first line that makes an admin shop, such as {@code Admin Shop}
 * @param containers the block materials a chest shop may trade from
 * @param shopLimits the most chest shops a player may own at each Shopkeeper level 1..5
 * @param summaryLines the most item lines in the "while you were away" summary
 * @param clickCooldownMillis the least time between one player's trades at sign shops, so an
 *     autoclicker cannot hammer a shop
 * @param buyTaxPercent percent of a buy's price kept by the server, taken from what the owner
 *     receives
 * @param sellTaxPercent percent of a sell's price kept by the server, taken from what the customer
 *     receives
 * @param creationFee crystals charged to open a chest shop; zero charges nothing
 * @param prices the cheapest and dearest a sign may ask
 * @param requireFullAmount a trade must move the sign's whole quantity
 * @param disabledWorlds worlds whose signs never become shops
 */
public record ChestShopSettings(
    Click buyClick,
    int maxQuantity,
    String adminShopLabel,
    List<String> containers,
    Map<Integer, Integer> shopLimits,
    int summaryLines,
    int clickCooldownMillis,
    int buyTaxPercent,
    int sellTaxPercent,
    long creationFee,
    PriceLimits prices,
    boolean requireFullAmount,
    List<String> disabledWorlds) {

  /** A mouse button on a sign. */
  public enum Click {
    LEFT,
    RIGHT
  }

  private static final Pattern MATERIAL = Pattern.compile("[A-Z0-9_]+");

  /**
   * The original settings, before tax, fees, price bands and world blocks. Those stay at no tax, no
   * fee, the full price range, full lots, and every world.
   */
  public record Basics(
      Click buyClick,
      int maxQuantity,
      String adminShopLabel,
      List<String> containers,
      Map<Integer, Integer> shopLimits,
      int summaryLines,
      int clickCooldownMillis) {}

  /** Settings with no tax, no fee, the full price range, full lots, and every world enabled. */
  public static ChestShopSettings untaxed(Basics basics) {
    return new ChestShopSettings(
        basics.buyClick(),
        basics.maxQuantity(),
        basics.adminShopLabel(),
        basics.containers(),
        basics.shopLimits(),
        basics.summaryLines(),
        basics.clickCooldownMillis(),
        0,
        0,
        0,
        new PriceLimits(
            1,
            com.shepherdjerred.thestorm.shops.domain.price.Price.MAX,
            1,
            com.shepherdjerred.thestorm.shops.domain.price.Price.MAX,
            Map.of()),
        true,
        List.of());
  }

  public ChestShopSettings {
    if (maxQuantity < 1) {
      throw new IllegalArgumentException("maxQuantity must be positive: " + maxQuantity);
    }
    if (adminShopLabel.isBlank()) {
      throw new IllegalArgumentException("adminShopLabel must not be blank");
    }
    containers = List.copyOf(containers);
    if (containers.isEmpty()) {
      throw new IllegalArgumentException("containers must list at least one material");
    }
    for (var container : containers) {
      if (!MATERIAL.matcher(container).matches()) {
        throw new IllegalArgumentException(
            "containers are material names like CHEST, not \"" + container + "\"");
      }
    }
    if (Set.copyOf(containers).size() != containers.size()) {
      throw new IllegalArgumentException("containers lists a material twice");
    }
    shopLimits = new ShopLimits(shopLimits).byLevel();
    if (summaryLines < 1) {
      throw new IllegalArgumentException("summaryLines must be positive: " + summaryLines);
    }
    if (clickCooldownMillis < 0) {
      throw new IllegalArgumentException(
          "clickCooldownMillis must not be negative: " + clickCooldownMillis);
    }
    if (buyTaxPercent < 0 || buyTaxPercent > 100 || sellTaxPercent < 0 || sellTaxPercent > 100) {
      throw new IllegalArgumentException("tax percents must be 0..100");
    }
    if (creationFee < 0) {
      throw new IllegalArgumentException("creationFee must not be negative: " + creationFee);
    }
    disabledWorlds = List.copyOf(disabledWorlds);
    for (var world : disabledWorlds) {
      if (world.isBlank()) {
        throw new IllegalArgumentException("disabledWorlds must name worlds");
      }
    }
  }

  /** The tax percent for a customer trading in {@code direction}. */
  public int taxPercent(Direction direction) {
    return direction == Direction.BUY ? buyTaxPercent : sellTaxPercent;
  }

  /** True when signs in {@code world} must not become shops. */
  public boolean shopsDisabledIn(String world) {
    return disabledWorlds.contains(world);
  }

  public Duration clickCooldown() {
    return Duration.ofMillis(clickCooldownMillis);
  }

  public ShopLimits limits() {
    return new ShopLimits(shopLimits);
  }

  /** Which way a click on a shop sign trades. */
  public Direction directionOf(Click click) {
    return click == buyClick ? Direction.BUY : Direction.SELL;
  }
}
