package com.shepherdjerred.thestorm.qol.domain.bank;

/**
 * What a player may do with someone else's bank. The owner may do all of these. A manager may too.
 * Adding shelves does not allow removing them, and the reverse is also true. Opening is included in
 * every other role, so a helper can still deposit.
 */
public enum BankRole {
  OPEN,
  ADD,
  REMOVE,
  MANAGE;

  /** Whether this role may do {@code needed}. */
  public boolean includes(BankRole needed) {
    return switch (this) {
      case MANAGE -> true;
      case ADD -> needed == ADD || needed == OPEN;
      case REMOVE -> needed == REMOVE || needed == OPEN;
      case OPEN -> needed == OPEN;
    };
  }
}
