package com.shepherdjerred.thestorm.towns.app;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.KeyedTransfer;
import com.shepherdjerred.thestorm.economy.app.Money;
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
 * The economy's wallets in memory: transfers complete at once, the server account never runs out,
 * and a test can make the next transfers fail.
 */
public final class FakeWallets implements Wallets {

  private final Map<AccountId, Long> balances = new HashMap<>();
  private final List<Receipt> receipts = new ArrayList<>();
  private final Map<UUID, KeyedTransfer> keyedRequests = new HashMap<>();
  private final Map<UUID, Receipt> keyedReceipts = new HashMap<>();
  private int failing;

  public void give(AccountId account, long amount) {
    balances.merge(account, amount, Long::sum);
  }

  public long balanceOf(AccountId account) {
    return balances.getOrDefault(account, 0L);
  }

  public List<Receipt> receipts() {
    return List.copyOf(receipts);
  }

  /** The next {@code count} transfers throw, as if the database failed. */
  public void failNext(int count) {
    failing = count;
  }

  @Override
  public CompletableFuture<Money> balance(AccountId account, CurrencyId currency) {
    if (currency != CurrencyId.CRYSTALS) {
      throw new IllegalArgumentException("this fake holds crystals only: " + currency);
    }
    return CompletableFuture.completedFuture(Money.crystals(balanceOf(account)));
  }

  @Override
  public CompletableFuture<Result<Receipt, EconomyError>> transfer(
      AccountId from, AccountId to, Money amount, String reason) {
    if (failing > 0) {
      failing--;
      return CompletableFuture.failedFuture(new IllegalStateException("ledger unavailable"));
    }
    if (amount.amount() == 0) {
      return CompletableFuture.completedFuture(
          Result.err(new EconomyError.ZeroAmount(amount.currency())));
    }
    if (from.equals(to)) {
      return CompletableFuture.completedFuture(Result.err(new EconomyError.SameAccount(from)));
    }
    var available = balanceOf(from);
    if (!(from instanceof AccountId.Server) && available < amount.amount()) {
      return CompletableFuture.completedFuture(
          Result.err(new EconomyError.InsufficientFunds(from, Money.crystals(available), amount)));
    }
    balances.merge(from, -amount.amount(), Long::sum);
    balances.merge(to, amount.amount(), Long::sum);
    var receipt = new Receipt(receipts.size() + 1L, from, to, amount, reason, Instant.EPOCH);
    receipts.add(receipt);
    return CompletableFuture.completedFuture(Result.ok(receipt));
  }

  @Override
  public CompletableFuture<Result<Receipt, EconomyError>> transferOnce(KeyedTransfer keyed) {
    var existing = keyedRequests.get(keyed.key());
    if (existing != null) {
      if (!existing.equals(keyed)) {
        return CompletableFuture.failedFuture(new IllegalArgumentException("transfer key reused"));
      }
      return CompletableFuture.completedFuture(
          Result.ok(requireNonNull(keyedReceipts.get(keyed.key()))));
    }
    return transfer(keyed.from(), keyed.to(), keyed.amount(), keyed.reason())
        .thenApply(
            result -> {
              if (result instanceof Result.Ok<Receipt, EconomyError> ok) {
                keyedRequests.put(keyed.key(), keyed);
                keyedReceipts.put(keyed.key(), ok.value());
              }
              return result;
            });
  }

  @Override
  public CompletableFuture<Optional<Receipt>> receiptFor(UUID key) {
    return CompletableFuture.completedFuture(Optional.ofNullable(keyedReceipts.get(key)));
  }

  @Override
  public CompletableFuture<List<Standing>> top(CurrencyId currency, int limit) {
    if (currency != CurrencyId.CRYSTALS) {
      throw new IllegalArgumentException("this fake holds crystals only: " + currency);
    }
    return CompletableFuture.completedFuture(List.of());
  }
}
