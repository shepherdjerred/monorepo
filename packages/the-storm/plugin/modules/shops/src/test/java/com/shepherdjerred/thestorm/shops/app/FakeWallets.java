package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * An in-memory ledger with the economy's rules: the server account is unlimited, every other
 * account must cover the amount. Tests can script a refusal or failure, or run a hook right after a
 * transfer lands, to stand in for the world changing while a payment settles.
 */
public final class FakeWallets implements Wallets {

  private final Map<AccountId, Long> balances = new HashMap<>();
  private final List<Receipt> receipts = new ArrayList<>();
  private final Deque<Runnable> afterTransfer = new ArrayDeque<>();
  private final Deque<RuntimeException> failures = new ArrayDeque<>();
  private final Deque<Runnable> held = new ArrayDeque<>();
  private final Deque<RuntimeException> toThrow = new ArrayDeque<>();
  private int holds;

  public void set(AccountId account, long crystals) {
    balances.put(account, crystals);
  }

  public long balanceOf(AccountId account) {
    return balances.getOrDefault(account, 0L);
  }

  public List<Receipt> receipts() {
    return List.copyOf(receipts);
  }

  /** Runs {@code hook} after the next transfer the ledger answers, paid or refused. */
  void afterNextTransfer(Runnable hook) {
    afterTransfer.add(hook);
  }

  /** The next transfer throws {@code failure} instead of returning a future; nothing moves. */
  void throwNext(RuntimeException failure) {
    toThrow.add(failure);
  }

  /** The next transfer's future fails with {@code failure}; nothing moves. */
  void failNext(RuntimeException failure) {
    failures.add(failure);
  }

  @Override
  public CompletableFuture<Crystals> balance(AccountId account) {
    return CompletableFuture.completedFuture(Crystals.of(balanceOf(account)));
  }

  @Override
  public CompletableFuture<Result<Receipt, EconomyError>> transfer(
      AccountId from, AccountId to, Crystals amount, String reason) {
    if (!toThrow.isEmpty()) {
      throw toThrow.removeFirst();
    }
    if (!failures.isEmpty()) {
      return CompletableFuture.failedFuture(failures.removeFirst());
    }
    var result = settle(from, to, amount, reason);
    if (holds > 0) {
      holds--;
      var answer = new CompletableFuture<Result<Receipt, EconomyError>>();
      held.add(() -> answer.complete(result));
      return answer;
    }
    return CompletableFuture.completedFuture(result);
  }

  /**
   * The next transfer lands in the ledger at once, but its answer waits for {@link #answerHeld},
   * like a ledger write that is slow to report back.
   */
  public void holdNext() {
    holds++;
  }

  /** Answers every held transfer, in order. */
  public void answerHeld() {
    while (!held.isEmpty()) {
      held.removeFirst().run();
    }
  }

  private Result<Receipt, EconomyError> settle(
      AccountId from, AccountId to, Crystals amount, String reason) {
    if (from.equals(to)) {
      return Result.err(new EconomyError.SameAccount(from));
    }
    if (amount.amount() == 0) {
      return Result.err(new EconomyError.ZeroAmount());
    }
    var server = from instanceof AccountId.Server;
    if (!server && balanceOf(from) < amount.amount()) {
      var refusal = new EconomyError.InsufficientFunds(from, Crystals.of(balanceOf(from)), amount);
      runHook();
      return Result.err(refusal);
    }
    if (!server) {
      balances.put(from, balanceOf(from) - amount.amount());
    }
    if (!(to instanceof AccountId.Server)) {
      balances.put(to, balanceOf(to) + amount.amount());
    }
    var receipt = new Receipt(receipts.size() + 1L, from, to, amount, reason, Instant.EPOCH);
    receipts.add(receipt);
    runHook();
    return Result.ok(receipt);
  }

  private void runHook() {
    if (!afterTransfer.isEmpty()) {
      afterTransfer.removeFirst().run();
    }
  }

  @Override
  public CompletableFuture<List<Standing>> top(int limit) {
    return CompletableFuture.completedFuture(List.of());
  }
}
