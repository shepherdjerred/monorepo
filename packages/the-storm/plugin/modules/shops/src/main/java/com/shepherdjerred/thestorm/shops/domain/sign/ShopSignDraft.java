package com.shepherdjerred.thestorm.shops.domain.sign;

import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;

/**
 * A shop sign whose lines parsed cleanly; permission, container and limit checks come next.
 *
 * @param owner whose shop it is
 * @param quantity items per trade
 * @param prices what one trade costs or pays
 * @param item the item named on the sign, or {@code ?}
 */
public record ShopSignDraft(OwnerLine owner, int quantity, ShopPrices prices, ItemLine item) {

  public ShopSignDraft {
    if (quantity < 1) {
      throw new IllegalArgumentException("quantity must be positive: " + quantity);
    }
  }
}
