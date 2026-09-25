package com.shepherdjerred.thestorm.economy.domain;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.EconomyError;

/** One condition a transfer must meet. Rules are small and composed by {@link TransferRules}. */
@FunctionalInterface
public interface TransferRule {

  /** Passes {@code pending} through unchanged when it meets this rule, or says why it does not. */
  Result<PendingTransfer, EconomyError> check(PendingTransfer pending);
}
