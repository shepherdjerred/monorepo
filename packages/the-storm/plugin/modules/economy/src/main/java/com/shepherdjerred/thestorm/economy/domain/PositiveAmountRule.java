package com.shepherdjerred.thestorm.economy.domain;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.EconomyError;

/** A transfer moves at least one unit of its currency. */
public final class PositiveAmountRule implements TransferRule {

  @Override
  public Result<PendingTransfer, EconomyError> check(PendingTransfer pending) {
    var amount = pending.transfer().amount();
    return amount.isZero()
        ? Result.err(new EconomyError.ZeroAmount(amount.currency()))
        : Result.ok(pending);
  }
}
