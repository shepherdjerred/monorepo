package com.shepherdjerred.thestorm.economy.domain;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.EconomyError;

/** A transfer moves at least one crystal. */
public final class PositiveAmountRule implements TransferRule {

  @Override
  public Result<PendingTransfer, EconomyError> check(PendingTransfer pending) {
    return pending.transfer().amount().amount() > 0
        ? Result.ok(pending)
        : Result.err(new EconomyError.ZeroAmount());
  }
}
