package com.shepherdjerred.thestorm.shops.domain.shop;

import com.shepherdjerred.thestorm.shops.domain.sign.OwnerLine;

/**
 * Everything the creation rules need to know about a player making a shop sign. Land protection is
 * checked separately, before these rules, because its refusals carry the land's own message.
 *
 * @param owner whose shop the sign asks for
 * @param admin whether the creator may make admin shops
 * @param shopkeeperLevel the creator's Shopkeeper level, 0..{@link ShopLimits#LEVELS}
 * @param ownedShops how many chest shops the creator already owns
 * @param container what the sign is attached to
 */
public record CreationAttempt(
    OwnerLine owner, boolean admin, int shopkeeperLevel, int ownedShops, Container container) {

  /** The block the sign hangs on, as the rules see it. */
  public enum Container {
    /** Not a shop container. */
    NONE,
    /** A container with no shops, or only the creator's. */
    FREE,
    /** A container another owner's shop already trades from. */
    TAKEN
  }

  public CreationAttempt {
    if (shopkeeperLevel < 0 || shopkeeperLevel > ShopLimits.LEVELS) {
      throw new IllegalArgumentException("Shopkeeper level out of range: " + shopkeeperLevel);
    }
    if (ownedShops < 0) {
      throw new IllegalArgumentException("owned shops must not be negative: " + ownedShops);
    }
  }
}
