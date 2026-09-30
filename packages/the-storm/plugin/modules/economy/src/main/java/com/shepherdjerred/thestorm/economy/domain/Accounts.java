package com.shepherdjerred.thestorm.economy.domain;

import com.shepherdjerred.thestorm.economy.app.AccountId;

/** Facts about account kinds. */
public final class Accounts {

  private Accounts() {}

  /**
   * Whether {@code account} has a stored balance. The server is the unlimited source and sink of
   * crystals, so only its ledger entries are kept, never a balance.
   */
  public static boolean hasBalance(AccountId account) {
    return switch (account) {
      case AccountId.Player _ -> true;
      case AccountId.Town _ -> true;
      case AccountId.Server _ -> false;
    };
  }
}
