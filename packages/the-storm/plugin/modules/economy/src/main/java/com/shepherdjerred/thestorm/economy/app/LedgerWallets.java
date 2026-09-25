package com.shepherdjerred.thestorm.economy.app;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * The economy's use cases over the ledger: the {@link Wallets} port other modules call, plus the
 * starting balance and administrator corrections the economy's own commands need.
 */
public final class LedgerWallets implements Wallets {

  /** The ledger reason of the one-time grant to a new player. */
  public static final String STARTING_BALANCE_REASON = "starting-balance";

  private final LedgerStore store;
  private final Crystals startingBalance;

  public LedgerWallets(LedgerStore store, Crystals startingBalance) {
    this.store = store;
    this.startingBalance = startingBalance;
  }

  @Override
  public CompletableFuture<Crystals> balance(AccountId account) {
    return store.balance(account);
  }

  @Override
  public CompletableFuture<Result<Receipt, EconomyError>> transfer(
      AccountId from, AccountId to, Crystals amount, String reason) {
    return store.transfer(from, to, amount, requireReason(reason));
  }

  @Override
  public CompletableFuture<List<Standing>> top(int limit) {
    if (limit < 1) {
      throw new IllegalArgumentException("limit must be positive: " + limit);
    }
    return store.top(limit);
  }

  /**
   * Grants the configured starting balance the first time {@code player} is ever seen. Safe to call
   * on every join: later calls change nothing and complete empty.
   */
  public CompletableFuture<Optional<Receipt>> welcome(UUID player) {
    return store.welcome(player, startingBalance, STARTING_BALANCE_REASON);
  }

  /** Sets {@code account}'s balance through a ledgered transfer to or from the server. */
  public CompletableFuture<Optional<Receipt>> setBalance(
      AccountId account, Crystals target, String reason) {
    return store.setBalance(account, target, requireReason(reason));
  }

  private static String requireReason(String reason) {
    if (reason.isBlank()) {
      throw new IllegalArgumentException("a transfer needs a reason for the ledger");
    }
    return reason;
  }
}
