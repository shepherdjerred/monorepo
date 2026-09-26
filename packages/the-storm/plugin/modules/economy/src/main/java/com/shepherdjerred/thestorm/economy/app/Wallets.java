package com.shepherdjerred.thestorm.economy.app;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * Balances and transfers. Every transfer is one ledger entry written atomically on the database
 * writer thread. Futures complete off the main thread; complete them back onto it with {@code
 * Scheduler.mainThread()} before touching the world.
 */
public interface Wallets {

  /** The current balance of {@code account}; zero for an account that has never been used. */
  CompletableFuture<Crystals> balance(AccountId account);

  /**
   * Moves {@code amount} from {@code from} to {@code to}. The server account never runs out; every
   * other account must cover the amount.
   */
  CompletableFuture<Result<Receipt, EconomyError>> transfer(
      AccountId from, AccountId to, Crystals amount, String reason);

  /** The richest player accounts, highest first. */
  CompletableFuture<List<Standing>> top(int limit);

  /**
   * One row of {@link #top}.
   *
   * @param account the player account
   * @param balance its balance
   */
  record Standing(AccountId.Player account, Crystals balance) {}
}
