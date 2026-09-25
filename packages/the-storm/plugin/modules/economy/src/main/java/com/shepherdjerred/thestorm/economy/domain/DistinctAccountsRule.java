package com.shepherdjerred.thestorm.economy.domain;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.EconomyError;

/** An account cannot pay itself. */
public final class DistinctAccountsRule implements TransferRule {

  @Override
  public Result<PendingTransfer, EconomyError> check(PendingTransfer pending) {
    var transfer = pending.transfer();
    return transfer.from().equals(transfer.to())
        ? Result.err(new EconomyError.SameAccount(transfer.from()))
        : Result.ok(pending);
  }
}
