package com.shepherdjerred.thestorm.economy.domain;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import java.util.ArrayList;
import java.util.List;

/**
 * Decides whether a transfer may happen and what it does to balances. Rules run in order and the
 * first refusal wins, so a player sees the most basic problem first (a zero amount before a
 * shortfall).
 */
public final class TransferRules {

  private final List<TransferRule> rules;

  public TransferRules(List<TransferRule> rules) {
    this.rules = List.copyOf(rules);
  }

  /** The economy's rules: a positive amount, two different accounts, and a payer who can pay. */
  public static TransferRules standard() {
    return new TransferRules(
        List.of(new PositiveAmountRule(), new DistinctAccountsRule(), new SufficientFundsRule()));
  }

  /** Checks {@code pending} against every rule, stopping at the first refusal. */
  public Result<PendingTransfer, EconomyError> validate(PendingTransfer pending) {
    Result<PendingTransfer, EconomyError> result = Result.ok(pending);
    for (var rule : rules) {
      result = result.flatMap(rule::check);
    }
    return result;
  }

  /** Validates {@code pending} and computes the balances to store if it is allowed. */
  public Result<Settlement, EconomyError> settle(PendingTransfer pending) {
    return validate(pending).map(TransferRules::apply);
  }

  private static Settlement apply(PendingTransfer pending) {
    var transfer = pending.transfer();
    var amount = transfer.amount();
    var updates = new ArrayList<BalanceUpdate>(2);
    if (Accounts.hasBalance(transfer.from())) {
      updates.add(
          new BalanceUpdate(
              transfer.from(), new Crystals(pending.payerBalance().amount() - amount.amount())));
    }
    if (Accounts.hasBalance(transfer.to())) {
      updates.add(new BalanceUpdate(transfer.to(), pending.payeeBalance().plus(amount)));
    }
    return new Settlement(transfer, updates);
  }
}
