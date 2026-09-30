package com.shepherdjerred.thestorm.economy.domain;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.EconomyError;

/** The payer covers the amount. The server is unlimited and always covers it. */
public final class SufficientFundsRule implements TransferRule {

  @Override
  public Result<PendingTransfer, EconomyError> check(PendingTransfer pending) {
    var transfer = pending.transfer();
    if (!Accounts.hasBalance(transfer.from())
        || pending.payerBalance().isAtLeast(transfer.amount())) {
      return Result.ok(pending);
    }
    return Result.err(
        new EconomyError.InsufficientFunds(
            transfer.from(), pending.payerBalance(), transfer.amount()));
  }
}
