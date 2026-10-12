package com.shepherdjerred.thestorm.essentials.testing;

import static java.util.Comparator.comparingLong;
import static java.util.concurrent.CompletableFuture.completedFuture;

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
 * An in-memory {@link Wallets} following the port's contract: the server account never runs out.
 * Essentials only ever moves crystals, so any other currency is a broken contract and throws.
 */
public class FakeWallets implements Wallets {

  private final Map<AccountId, Long> balances = new HashMap<>();
  private final List<Receipt> receipts = new ArrayList<>();
  private final Map<UUID, KeyedTransfer> keyedRequests = new HashMap<>();
  private final Map<UUID, Receipt> keyedReceipts = new HashMap<>();

  public void deposit(AccountId account, long amount) {
    balances.merge(account, amount, Long::sum);
  }

  public long balanceOf(AccountId account) {
    return balances.getOrDefault(account, 0L);
  }

  public List<Receipt> receipts() {
    return List.copyOf(receipts);
  }

  @Override
  public CompletableFuture<Money> balance(AccountId account, CurrencyId currency) {
    return completedFuture(Money.of(crystalsOnly(currency), balanceOf(account)));
  }

  private static CurrencyId crystalsOnly(CurrencyId currency) {
    if (currency != CurrencyId.CRYSTALS) {
      throw new IllegalArgumentException("essentials only moves crystals, not " + currency.key());
    }
    return currency;
  }

  @Override
  public CompletableFuture<Result<Receipt, EconomyError>> transfer(
      AccountId from, AccountId to, Money amount, String reason) {
    crystalsOnly(amount.currency());
    if (amount.isZero()) {
      return completedFuture(Result.err(new EconomyError.ZeroAmount(amount.currency())));
    }
    if (from.equals(to)) {
      return completedFuture(Result.err(new EconomyError.SameAccount(from)));
    }
    var isServer = from instanceof AccountId.Server;
    var balance = balanceOf(from);
    if (!isServer && balance < amount.amount()) {
      return completedFuture(
          Result.err(new EconomyError.InsufficientFunds(from, Money.crystals(balance), amount)));
    }
    if (!isServer) {
      balances.put(from, balance - amount.amount());
    }
    deposit(to, amount.amount());
    var receipt = new Receipt(receipts.size() + 1L, from, to, amount, reason, Instant.EPOCH);
    receipts.add(receipt);
    return completedFuture(Result.ok(receipt));
  }

  @Override
  public CompletableFuture<Result<Receipt, EconomyError>> transferOnce(KeyedTransfer request) {
    var prior = keyedRequests.get(request.key());
    if (prior != null) {
      if (!prior.equals(request)) {
        throw new IllegalStateException("transfer key reused for different details");
      }
      return completedFuture(Result.ok(keyedReceipts.get(request.key())));
    }
    return transfer(request.from(), request.to(), request.amount(), request.reason())
        .thenApply(
            result -> {
              if (result instanceof Result.Ok<Receipt, EconomyError>(var receipt)) {
                keyedRequests.put(request.key(), request);
                keyedReceipts.put(request.key(), receipt);
              }
              return result;
            });
  }

  @Override
  public CompletableFuture<Optional<Receipt>> receiptFor(UUID key) {
    return completedFuture(Optional.ofNullable(keyedReceipts.get(key)));
  }

  @Override
  public CompletableFuture<List<Standing>> top(CurrencyId currency, int limit) {
    crystalsOnly(currency);
    return completedFuture(
        balances.entrySet().stream()
            .filter(entry -> entry.getKey() instanceof AccountId.Player)
            .map(
                entry ->
                    new Standing(
                        (AccountId.Player) entry.getKey(), Money.crystals(entry.getValue())))
            .sorted(comparingLong((Standing standing) -> standing.balance().amount()).reversed())
            .limit(limit)
            .toList());
  }
}
