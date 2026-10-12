package com.shepherdjerred.thestorm.economy.app;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Balances and transfers, one balance per account and {@link CurrencyId}. Every transfer moves one
 * currency and is one ledger entry written atomically on the database writer thread. Futures
 * complete off the main thread; complete them back onto it with {@code Scheduler.mainThread()}
 * before touching the world.
 */
public interface Wallets {

  /** The current {@code currency} balance of {@code account}; zero when it has never held any. */
  CompletableFuture<Money> balance(AccountId account, CurrencyId currency);

  /**
   * Moves {@code amount} (in its currency) from {@code from} to {@code to}. The server account
   * never runs out; every other account must cover the amount in that currency.
   */
  CompletableFuture<Result<Receipt, EconomyError>> transfer(
      AccountId from, AccountId to, Money amount, String reason);

  /**
   * Applies a transfer once for a stable operation key. Repeating the same request returns its
   * original receipt; reusing the key for different transfer details, including another currency,
   * is an internal contract error.
   */
  CompletableFuture<Result<Receipt, EconomyError>> transferOnce(KeyedTransfer transfer);

  /** The committed receipt for a keyed transfer, if one exists. */
  CompletableFuture<Optional<Receipt>> receiptFor(UUID key);

  /** The player accounts holding the most {@code currency}, highest first. */
  CompletableFuture<List<Standing>> top(CurrencyId currency, int limit);

  /**
   * One row of {@link #top}.
   *
   * @param account the player account
   * @param balance its balance
   */
  record Standing(AccountId.Player account, Money balance) {}
}
