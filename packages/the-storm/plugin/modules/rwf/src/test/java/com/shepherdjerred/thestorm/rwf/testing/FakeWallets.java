package com.shepherdjerred.thestorm.rwf.testing;

import static java.util.concurrent.CompletableFuture.completedFuture;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.KeyedTransfer;
import com.shepherdjerred.thestorm.economy.app.Money;
import com.shepherdjerred.thestorm.economy.app.MoneyFormatter;
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
 * In-memory wallets with one balance per account and currency, following the port's contract: the
 * server never runs out, everyone else must cover a transfer in its currency, and a keyed transfer
 * pays once. Also a plain formatter.
 */
public final class FakeWallets implements Wallets, MoneyFormatter {

  private final List<Receipt> receipts = new ArrayList<>();
  private final Map<Map.Entry<AccountId, CurrencyId>, Long> balances = new HashMap<>();
  private final Map<UUID, KeyedTransfer> keyed = new HashMap<>();
  private final Map<UUID, Receipt> keyedReceipts = new HashMap<>();

  public synchronized List<Receipt> receipts() {
    return List.copyOf(receipts);
  }

  /** Sets {@code account}'s balance directly, outside the ledger. */
  public synchronized void hold(AccountId account, Money amount) {
    balances.put(Map.entry(account, amount.currency()), amount.amount());
  }

  public synchronized Money held(AccountId account, CurrencyId currency) {
    return Money.of(currency, balances.getOrDefault(Map.entry(account, currency), 0L));
  }

  @Override
  public CompletableFuture<Money> balance(AccountId account, CurrencyId currency) {
    return completedFuture(held(account, currency));
  }

  @Override
  public synchronized CompletableFuture<Result<Receipt, EconomyError>> transfer(
      AccountId from, AccountId to, Money amount, String reason) {
    if (amount.isZero()) {
      return completedFuture(Result.err(new EconomyError.ZeroAmount(amount.currency())));
    }
    if (from.equals(to)) {
      return completedFuture(Result.err(new EconomyError.SameAccount(from)));
    }
    var payer = held(from, amount.currency());
    if (!(from instanceof AccountId.Server)) {
      if (!payer.isAtLeast(amount)) {
        return completedFuture(Result.err(new EconomyError.InsufficientFunds(from, payer, amount)));
      }
      hold(from, payer.minus(amount));
    }
    if (!(to instanceof AccountId.Server)) {
      hold(to, held(to, amount.currency()).plus(amount));
    }
    var receipt = new Receipt(receipts.size() + 1L, from, to, amount, reason, Instant.EPOCH);
    receipts.add(receipt);
    return completedFuture(Result.ok(receipt));
  }

  @Override
  public synchronized CompletableFuture<Result<Receipt, EconomyError>> transferOnce(
      KeyedTransfer request) {
    var previous = keyed.get(request.key());
    if (previous != null) {
      if (!previous.equals(request)) {
        throw new IllegalArgumentException("transfer key reused with different details");
      }
      return completedFuture(Result.ok(keyedReceipts.get(request.key())));
    }
    return transfer(request.from(), request.to(), request.amount(), request.reason())
        .thenApply(
            result -> {
              if (result instanceof Result.Ok<Receipt, EconomyError>(var receipt)) {
                keyed.put(request.key(), request);
                keyedReceipts.put(request.key(), receipt);
              }
              return result;
            });
  }

  @Override
  public synchronized CompletableFuture<Optional<Receipt>> receiptFor(UUID key) {
    return completedFuture(Optional.ofNullable(keyedReceipts.get(key)));
  }

  @Override
  public CompletableFuture<List<Standing>> top(CurrencyId currency, int limit) {
    return completedFuture(List.of());
  }

  @Override
  public String words(Money amount) {
    return amount.amount() + (amount.currency() == CurrencyId.CRYSTALS ? " crystals" : " Credits");
  }

  @Override
  public String symbol(Money amount) {
    return amount.amount() + (amount.currency() == CurrencyId.CRYSTALS ? " CR" : " RC");
  }
}
