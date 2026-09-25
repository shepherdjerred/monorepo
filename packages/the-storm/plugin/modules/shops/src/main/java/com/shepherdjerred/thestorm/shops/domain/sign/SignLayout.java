package com.shepherdjerred.thestorm.shops.domain.sign;

import com.shepherdjerred.thestorm.shops.domain.price.Price;
import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import java.util.ArrayList;

/** The lines a finished shop sign shows, in the same format players write. */
public final class SignLayout {

  private SignLayout() {}

  /**
   * The four lines of a shop.
   *
   * @param owner the owner's name or the admin-shop label
   * @param itemLabel the item line, from {@link ItemNames#signLabel} or {@code ?}
   */
  public static SignLines render(String owner, int quantity, ShopPrices prices, String itemLabel) {
    return SignLines.of(owner, Integer.toString(quantity), priceLine(prices), itemLabel);
  }

  /** {@code B 50:S 40}, {@code B 50} or {@code S 40}. */
  public static String priceLine(ShopPrices prices) {
    var parts = new ArrayList<String>(2);
    prices.buy().ifPresent(price -> parts.add("B " + amount(price)));
    prices.sell().ifPresent(price -> parts.add("S " + amount(price)));
    return String.join(":", parts);
  }

  private static String amount(Price price) {
    return Long.toString(price.crystals());
  }
}
