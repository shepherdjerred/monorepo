package com.shepherdjerred.thestorm.economy.domain;

import com.shepherdjerred.thestorm.economy.app.Money;

/**
 * A transfer together with the balances it would change, as read inside the writing transaction.
 * Both balances are in the transfer's currency. The server's balance is meaningless (it is
 * unlimited) and is passed as zero.
 *
 * @param transfer what is requested
 * @param payerBalance the paying account's current balance
 * @param payeeBalance the receiving account's current balance
 */
public record PendingTransfer(Transfer transfer, Money payerBalance, Money payeeBalance) {

  public PendingTransfer {
    var currency = transfer.amount().currency();
    if (payerBalance.currency() != currency || payeeBalance.currency() != currency) {
      throw new IllegalArgumentException(
          "balances must be in the transfer's currency " + currency.key());
    }
  }
}
