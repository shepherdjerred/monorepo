package com.shepherdjerred.thestorm.tracks.app;

import static java.util.Objects.requireNonNull;
import static java.util.concurrent.CompletableFuture.completedFuture;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.KeyedTransfer;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * An in-memory economy: the server account is unlimited, players must cover what they pay. Tests
 * can make the next transfers refuse or fail.
 */
public final class FakeWallets implements Wallets {

  private static final AccountId SERVER = new AccountId.Server();

  private final Map<AccountId, Long> balances = new HashMap<>();
  private final List<Receipt> receipts = new ArrayList<>();
  private final Map<UUID, KeyedTransfer> keyed = new HashMap<>();
  private final Map<UUID, Receipt> keyedReceipts = new HashMap<>();
  private int refuseTransfers;
  private int failTransfersAfter = Integer.MAX_VALUE;

  public synchronized void give(AccountId account, long amount) {
    balances.merge(account, amount, Long::sum);
  }

  public synchronized long balanceOf(AccountId account) {
    return balances.getOrDefault(account, 0L);
  }

  public synchronized List<Receipt> receipts() {
    return List.copyOf(receipts);
  }

  /** The next {@code count} transfers are refused as if the payer were short. */
  public synchronized void refuseNext(int count) {
    refuseTransfers = count;
  }

  /** After {@code successes} more transfers, every transfer's future fails. */
  public synchronized void failAfter(int successes) {
    failTransfersAfter = receipts.size() + successes;
  }

  @Override
  public synchronized CompletableFuture<Crystals> balance(AccountId account) {
    return completedFuture(Crystals.of(balanceOf(account)));
  }

  @Override
  public synchronized CompletableFuture<Result<Receipt, EconomyError>> transfer(
      AccountId from, AccountId to, Crystals amount, String reason) {
    if (receipts.size() >= failTransfersAfter) {
      return CompletableFuture.failedFuture(new IllegalStateException("ledger offline"));
    }
    var balance = Crystals.of(balanceOf(from));
    if (refuseTransfers > 0 || (!from.equals(SERVER) && !balance.isAtLeast(amount))) {
      refuseTransfers = Math.max(0, refuseTransfers - 1);
      return completedFuture(Result.err(new EconomyError.InsufficientFunds(from, balance, amount)));
    }
    if (!from.equals(SERVER)) {
      balances.merge(from, -amount.amount(), Long::sum);
    }
    if (!to.equals(SERVER)) {
      balances.merge(to, amount.amount(), Long::sum);
    }
    var receipt = new Receipt(receipts.size() + 1L, from, to, amount, reason, Instant.EPOCH);
    receipts.add(receipt);
    return completedFuture(Result.ok(receipt));
  }

  @Override
  public synchronized CompletableFuture<Result<Receipt, EconomyError>> transferOnce(
      KeyedTransfer transfer) {
    var previous = keyed.get(transfer.key());
    if (previous != null) {
      if (!previous.equals(transfer)) {
        throw new IllegalArgumentException("transfer key reused with different details");
      }
      return completedFuture(Result.ok(requireNonNull(keyedReceipts.get(transfer.key()))));
    }
    return transfer(transfer.from(), transfer.to(), transfer.amount(), transfer.reason())
        .thenApply(
            result -> {
              if (result instanceof Result.Ok<Receipt, EconomyError>(var receipt)) {
                keyed.put(transfer.key(), transfer);
                keyedReceipts.put(transfer.key(), receipt);
              }
              return result;
            });
  }

  @Override
  public synchronized CompletableFuture<Optional<Receipt>> receiptFor(UUID key) {
    return completedFuture(Optional.ofNullable(keyedReceipts.get(key)));
  }

  @Override
  public CompletableFuture<List<Standing>> top(int limit) {
    return completedFuture(List.of());
  }
}
