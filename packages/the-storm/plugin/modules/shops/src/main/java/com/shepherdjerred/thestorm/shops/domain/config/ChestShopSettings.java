package com.shepherdjerred.thestorm.shops.domain.config;

import com.shepherdjerred.thestorm.shops.domain.shop.ShopLimits;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
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
 */
public record ChestShopSettings(
    Click buyClick,
    int maxQuantity,
    String adminShopLabel,
    List<String> containers,
    Map<Integer, Integer> shopLimits,
    int summaryLines) {

  /** A mouse button on a sign. */
  public enum Click {
    LEFT,
    RIGHT
  }

  private static final Pattern MATERIAL = Pattern.compile("[A-Z0-9_]+");

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
  }

  public ShopLimits limits() {
    return new ShopLimits(shopLimits);
  }

  /** Which way a click on a shop sign trades. */
  public Direction directionOf(Click click) {
    return click == buyClick ? Direction.BUY : Direction.SELL;
  }
}
