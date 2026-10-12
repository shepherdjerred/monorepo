package com.shepherdjerred.thestorm.economy.domain;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Money;

/**
 * The new balance of one stored account after a transfer.
 *
 * @param account a player or town account, never the server
 * @param balance its balance in the transfer's currency after the transfer
 */
public record BalanceUpdate(AccountId account, Money balance) {

  public BalanceUpdate {
    if (!Accounts.hasBalance(account)) {
      throw new IllegalArgumentException("the server account has no stored balance");
    }
  }
}
