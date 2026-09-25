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
    };
  }
}
