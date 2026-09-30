package com.shepherdjerred.thestorm.shops.domain.shop;

import java.util.UUID;

/** Who a sign shop trades for. */
public sealed interface ShopOwner {

  /**
   * A player's chest shop, stocked from its container and paying into their wallet.
   *
   * @param id the owner's id
   * @param name the owner's name when the shop was made, shown on the sign
   */
  record Player(UUID id, String name) implements ShopOwner {}

  /** A server shop: unlimited stock, trading with the server account. */
  record Admin() implements ShopOwner {}

  /** Whether {@code player} owns this shop. Nobody owns an admin shop. */
  default boolean isOwnedBy(UUID player) {
    return this instanceof Player(var id, _) && id.equals(player);
  }
}
