package com.shepherdjerred.thestorm.essentials.testing;

import static java.util.Comparator.comparing;
import static java.util.concurrent.CompletableFuture.completedFuture;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * An in-memory {@link Wallets} following the port's contract: the server account never runs out.
 */
public class FakeWallets implements Wallets {

  private final Map<AccountId, Long> balances = new HashMap<>();
  private final List<Receipt> receipts = new ArrayList<>();

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
  public CompletableFuture<Crystals> balance(AccountId account) {
    return completedFuture(Crystals.of(balanceOf(account)));
  }

  @Override
  public CompletableFuture<Result<Receipt, EconomyError>> transfer(
      AccountId from, AccountId to, Crystals amount, String reason) {
    if (amount.amount() == 0) {
      return completedFuture(Result.err(new EconomyError.ZeroAmount()));
    }
    if (from.equals(to)) {
      return completedFuture(Result.err(new EconomyError.SameAccount(from)));
    }
    var isServer = from instanceof AccountId.Server;
    var balance = balanceOf(from);
    if (!isServer && balance < amount.amount()) {
      return completedFuture(
          Result.err(new EconomyError.InsufficientFunds(from, Crystals.of(balance), amount)));
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
  public CompletableFuture<List<Standing>> top(int limit) {
    return completedFuture(
        balances.entrySet().stream()
            .filter(entry -> entry.getKey() instanceof AccountId.Player)
            .map(
                entry ->
                    new Standing((AccountId.Player) entry.getKey(), Crystals.of(entry.getValue())))
            .sorted(comparing(Standing::balance).reversed())
            .limit(limit)
            .toList());
  }
}
