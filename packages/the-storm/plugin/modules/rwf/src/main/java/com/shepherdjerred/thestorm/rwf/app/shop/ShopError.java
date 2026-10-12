package com.shepherdjerred.thestorm.rwf.app.shop;

/** Why a kit was not bought. */
public sealed interface ShopError {

  /** The kit is free or not for sale. */
  record NotForSale(String kit) implements ShopError {}

  /** They own it already. */
  record AlreadyOwned(String kit) implements ShopError {}

  /** A purchase of it is already under way for them. */
  record InProgress(String kit) implements ShopError {}

  /**
   * They cannot cover the price.
   *
   * @param price the kit's price
   * @param balance what they hold
   */
  record TooPoor(long price, long balance) implements ShopError {}
}
