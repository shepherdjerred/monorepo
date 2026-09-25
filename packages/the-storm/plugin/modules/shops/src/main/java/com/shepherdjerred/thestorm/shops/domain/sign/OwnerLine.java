package com.shepherdjerred.thestorm.shops.domain.sign;

/** Whose shop a sign makes, read from its first line. */
public sealed interface OwnerLine {

  /** The creator's own shop; the line is filled in with their name. */
  record Creator() implements OwnerLine {}

  /** A server shop with unlimited stock, trading with the server account. */
  record AdminShop() implements OwnerLine {}
}
