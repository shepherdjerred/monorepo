package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.KeyedTransfer;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.qol.app.QolStore;
import com.shepherdjerred.thestorm.qol.app.RtpAttempt;
import java.util.concurrent.CompletableFuture;

/** Settle old QoL obligations with their original ledger keys before shared travel starts. */
final class LegacyRtpRecovery {
  private LegacyRtpRecovery() {}

  static CompletableFuture<Void> start(QolStore store, Wallets wallets) {
    return store
        .pendingRtpAttempts()
        .thenCompose(
            attempts ->
                CompletableFuture.allOf(
                    attempts.stream()
                        .map(attempt -> recover(store, wallets, attempt))
                        .toArray(CompletableFuture<?>[]::new)));
  }

  private static CompletableFuture<Void> recover(
      QolStore store, Wallets wallets, RtpAttempt attempt) {
    return wallets
        .receiptFor(attempt.id())
        .thenCompose(
            receipt -> {
              if (receipt.isEmpty()) {
                return store.deleteRtpAttempt(attempt.id());
              }
              return wallets
                  .transferOnce(
                      new KeyedTransfer(
                          attempt.refundKey(),
                          new AccountId.Server(),
                          new AccountId.Player(attempt.player()),
                          Crystals.of(attempt.cost()),
                          "rtp refund"))
                  .thenCompose(
                      result ->
                          switch (result) {
                            case Result.Ok<Receipt, EconomyError> _ ->
                                store.deleteRtpAttempt(attempt.id());
                            case Result.Err<Receipt, EconomyError>(var error) ->
                                CompletableFuture.failedFuture(
                                    new IllegalStateException("RTP refund refused: " + error));
                          });
            });
  }
}
