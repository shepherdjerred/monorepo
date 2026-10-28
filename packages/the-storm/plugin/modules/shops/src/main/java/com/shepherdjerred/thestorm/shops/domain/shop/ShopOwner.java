package com.shepherdjerred.thestorm.shops.domain.shop;

import java.util.Optional;
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

  /**
   * A town's chest shop. Stock sits in the container; crystals go to the town treasury.
   *
   * @param id the town's id
   * @param name the town's name, shown on the sign
   */
  record Town(UUID id, String name) implements ShopOwner {}

  /** A server shop: unlimited stock, trading with the server account. */
  record Admin() implements ShopOwner {}

  /** Whether {@code id} is this shop's player or town. Nobody owns an admin shop. */
  default boolean isOwnedBy(UUID id) {
    return switch (this) {
      case Player(var owner, _) -> owner.equals(id);
      case Town(var town, _) -> town.equals(id);
      case Admin() -> false;
    };
  }

  /** The name on the sign when the shop is not an admin shop. */
  default Optional<String> otherName() {
    return switch (this) {
      case Player(_, var name) -> Optional.of(name);
      case Town(_, var name) -> Optional.of(name);
      case Admin() -> Optional.empty();
    };
  }
}
