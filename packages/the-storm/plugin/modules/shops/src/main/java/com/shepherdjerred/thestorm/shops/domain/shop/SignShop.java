package com.shepherdjerred.thestorm.shops.domain.shop;

import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import com.shepherdjerred.thestorm.shops.domain.sign.ItemLine;
import com.shepherdjerred.thestorm.shops.domain.sign.ItemNames;
import com.shepherdjerred.thestorm.shops.domain.sign.SignLayout;
import com.shepherdjerred.thestorm.shops.domain.sign.SignLines;
import java.time.Instant;
import java.util.Optional;

/**
 * A shop made from a sign.
 *
 * @param id the shop's id, also stored on the sign
 * @param sign where the sign is
 * @param container the container it trades from; admin shops may have none
 * @param owner who it trades for
 * @param quantity items per trade
 * @param prices what one trade costs or pays
 * @param item what it trades; empty until the owner sets it
 * @param createdAt when it was made
 */
public record SignShop(
    long id,
    BlockPos sign,
    Optional<BlockPos> container,
    ShopOwner owner,
    int quantity,
    ShopPrices prices,
    Optional<ItemFingerprint> item,
    Instant createdAt) {

  public SignShop {
    if (id < 1) {
      throw new IllegalArgumentException("shop ids start at 1: " + id);
    }
    if (quantity < 1) {
      throw new IllegalArgumentException("quantity must be positive: " + quantity);
    }
    if (owner instanceof ShopOwner.Player && container.isEmpty()) {
      throw new IllegalArgumentException("a player's shop needs a container");
    }
  }

  public boolean isAdmin() {
    return owner instanceof ShopOwner.Admin;
  }

  public SignShop withItem(ItemFingerprint fingerprint) {
    return new SignShop(
        id, sign, container, owner, quantity, prices, Optional.of(fingerprint), createdAt);
  }

  /** What the sign shows. */
  public SignLines lines(String adminShopLabel) {
    var ownerLabel =
        switch (owner) {
          case ShopOwner.Player(_, var name) -> name;
          case ShopOwner.Admin() -> adminShopLabel;
        };
    var itemLabel =
        item.map(found -> ItemNames.signLabel(found.material(), found.special()))
            .orElse(ItemLine.PENDING_MARKER);
    return SignLayout.render(ownerLabel, quantity, prices, itemLabel);
  }
}
