package com.shepherdjerred.thestorm.economy.app;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * The economy's use cases over the ledger: the {@link Wallets} port other modules call, plus the
 * starting balance, player lookup, leaderboards and administrator corrections the economy's own
 * commands need.
 */
public final class LedgerWallets implements Wallets {

  /** The ledger reason of the one-time grant to a new player. */
  public static final String STARTING_BALANCE_REASON = "starting-balance";

  private final LedgerStore store;
  private final Money startingBalance;

  public LedgerWallets(LedgerStore store, Money startingBalance) {
    this.store = store;
    this.startingBalance = startingBalance;
  }

  @Override
  public CompletableFuture<Money> balance(AccountId account, CurrencyId currency) {
    return store.balance(account, currency);
  }

  /** Every currency's balance of {@code account}, in {@link CurrencyId} order. */
  public CompletableFuture<Map<CurrencyId, Money>> balances(AccountId account) {
    return store.balances(account);
  }

  @Override
  public CompletableFuture<Result<Receipt, EconomyError>> transfer(
      AccountId from, AccountId to, Money amount, String reason) {
    return store.transfer(from, to, amount, requireReason(reason));
  }

  @Override
  public CompletableFuture<Result<Receipt, EconomyError>> transferOnce(KeyedTransfer transfer) {
    return store.transferOnce(
        new KeyedTransfer(
            transfer.key(),
            transfer.from(),
            transfer.to(),
            transfer.amount(),
            requireReason(transfer.reason())));
  }

  @Override
  public CompletableFuture<Optional<Receipt>> receiptFor(UUID key) {
    return store.receiptFor(key);
  }

  @Override
  public CompletableFuture<List<Standing>> top(CurrencyId currency, int limit) {
    return leaderboard(currency, limit)
        .thenApply(ranked -> ranked.stream().map(RankedPlayer::standing).toList());
  }

  /** The players holding the most {@code currency}, with the names they last joined under. */
  public CompletableFuture<List<RankedPlayer>> leaderboard(CurrencyId currency, int limit) {
    if (limit < 1) {
      throw new IllegalArgumentException("limit must be positive: " + limit);
    }
    return store.top(currency, limit);
  }

  /** The player who most recently joined as {@code name}, ignoring case. */
  public CompletableFuture<Optional<SeenPlayer>> findPlayer(String name) {
    return store.findPlayer(name);
  }

  /**
   * Records {@code player}'s current name and grants the configured starting balance the first time
   * they are ever seen. Safe to call on every join: later calls only refresh the name and complete
   * empty.
   */
  public CompletableFuture<Optional<Receipt>> welcome(SeenPlayer player) {
    return welcome(player, true);
  }

  /** Records a join; only a genuinely new player can receive the starting grant. */
  public CompletableFuture<Optional<Receipt>> welcome(SeenPlayer player, boolean firstServerJoin) {
    return store.welcome(
        player,
        firstServerJoin ? startingBalance : Money.zero(startingBalance.currency()),
        STARTING_BALANCE_REASON);
  }

  /** Sets {@code account}'s balance through a ledgered transfer to or from the server. */
  public CompletableFuture<Optional<Receipt>> setBalance(
      AccountId account, Money target, String reason) {
    return store.setBalance(account, target, requireReason(reason));
  }

  private static String requireReason(String reason) {
    if (reason.isBlank()) {
      throw new IllegalArgumentException("a transfer needs a reason for the ledger");
    }
    return reason;
  }
}
