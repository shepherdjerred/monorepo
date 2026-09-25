package com.shepherdjerred.thestorm.arena.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Pays wave rewards from the server account, each with an auditable ledger reason. */
public final class RewardPayer {

  private final Wallets wallets;

  public RewardPayer(Wallets wallets) {
    this.wallets = wallets;
  }

  /** Pays {@code player} {@code crystals} for clearing {@code wave} of {@code arena}. */
  public CompletableFuture<Result<Receipt, EconomyError>> pay(
      String arena, UUID player, long crystals, int wave) {
    return wallets.transfer(
        new AccountId.Server(),
        new AccountId.Player(player),
        Crystals.of(crystals),
        reason(arena, wave));
  }

  /** The ledger reason, such as {@code arena:colosseum:wave40}. */
  public static String reason(String arena, int wave) {
    return "arena:" + arena + ":wave" + wave;
  }
}
