package com.shepherdjerred.thestorm.economy.app;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

/**
 * Durable balances, the ledger and the players the economy has seen, implemented by the economy's
 * database adapter. Internal to the economy module: other modules use {@link Wallets}. Each write
 * is one transaction that reads the balances it needs, applies the domain's transfer rules, and
 * records one ledger entry per transfer.
 */
public interface LedgerStore {

  /** The stored balance of {@code account}; zero when it has none (and always for the server). */
  CompletableFuture<Crystals> balance(AccountId account);

  /** Applies the transfer rules and, when they allow it, moves the crystals and records it. */
  CompletableFuture<Result<Receipt, EconomyError>> transfer(
      AccountId from, AccountId to, Crystals amount, String reason);

  /** Up to {@code limit} player accounts with a positive balance, richest first, with names. */
  CompletableFuture<List<RankedPlayer>> top(int limit);

  /**
   * Records that {@code player} joined under their current name and, the first time only, pays them
   * {@code grant} from the server. Empty when the player was already seen or {@code grant} is zero.
   */
  CompletableFuture<Optional<Receipt>> welcome(SeenPlayer player, Crystals grant, String reason);

  /** The player who most recently joined as {@code name}, ignoring case; empty if nobody has. */
  CompletableFuture<Optional<SeenPlayer>> findPlayer(String name);

  /**
   * Brings {@code account} to exactly {@code target} with one transfer to or from the server. Empty
   * when it already holds {@code target}.
   */
  CompletableFuture<Optional<Receipt>> setBalance(
      AccountId account, Crystals target, String reason);
}
