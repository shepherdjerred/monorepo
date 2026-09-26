package com.shepherdjerred.thestorm.shops.domain.shop;

/** Why a player may not make the shop their sign asks for. */
public sealed interface CreationProblem {

  /** Admin shops need the admin permission. */
  record NotAdmin() implements CreationProblem {}

  /** Chest shops need Shopkeeper I. */
  record NotShopkeeper() implements CreationProblem {}

  /** The creator already owns as many shops as their Shopkeeper level allows. */
  record LimitReached(int limit) implements CreationProblem {}

  /** A chest shop's sign must hang on a shop container. */
  record NoContainer() implements CreationProblem {}

  /** Someone else's shop already trades from this container. */
  record ContainerTaken() implements CreationProblem {}

  /**
   * An admin shop whose prices would let players buy from one server shop and sell to another (or
   * this one) in a loop.
   *
   * @param with the server shop it would loop with
   */
  record PriceLoop(String with) implements CreationProblem {}

  /**
   * An admin shop may not trade a shulker box, bundle or other container with items inside: its
   * endless stock would hand out endless copies of what is inside.
   */
  record HoldsItems() implements CreationProblem {}

  /** A sentence for the creator. */
  default String describe() {
    return switch (this) {
      case NotAdmin() -> "Only admins can make admin shops.";
      case NotShopkeeper() -> "You need Shopkeeper I to open a chest shop.";
      case LimitReached(var limit) ->
          "You already own "
              + limit
              + (limit == 1 ? " shop" : " shops")
              + ", the most your Shopkeeper level allows.";
      case NoContainer() -> "Put the shop sign on a chest, barrel or copper chest.";
      case ContainerTaken() -> "Another player's shop already uses that container.";
      case HoldsItems() ->
          "Admin shops cannot trade a shulker box, bundle or other container with items inside.";
      case PriceLoop(var with) ->
          "Those prices would let players trade in a loop with "
              + with
              + ": server shops never pay more per item than any server shop charges.";
    };
  }
}
