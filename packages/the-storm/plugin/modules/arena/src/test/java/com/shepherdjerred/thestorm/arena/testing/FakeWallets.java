package com.shepherdjerred.thestorm.arena.testing;

import static java.util.concurrent.CompletableFuture.completedFuture;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/** Wallets that record every transfer and always succeed, and a plain crystal formatter. */
public final class FakeWallets implements Wallets, CrystalFormatter {

  private final List<Receipt> receipts = new ArrayList<>();

  public synchronized List<Receipt> receipts() {
    return List.copyOf(receipts);
  }

  @Override
  public CompletableFuture<Crystals> balance(AccountId account) {
    return completedFuture(Crystals.ZERO);
  }

  @Override
  public synchronized CompletableFuture<Result<Receipt, EconomyError>> transfer(
      AccountId from, AccountId to, Crystals amount, String reason) {
    var receipt = new Receipt(receipts.size() + 1L, from, to, amount, reason, Instant.EPOCH);
    receipts.add(receipt);
    return completedFuture(Result.ok(receipt));
  }

  @Override
  public CompletableFuture<List<Standing>> top(int limit) {
    return completedFuture(List.of());
  }

  @Override
  public String words(Crystals amount) {
    return amount.amount() + " crystals";
  }

  @Override
  public String symbol(Crystals amount) {
    return amount.amount() + " CR";
  }
}
