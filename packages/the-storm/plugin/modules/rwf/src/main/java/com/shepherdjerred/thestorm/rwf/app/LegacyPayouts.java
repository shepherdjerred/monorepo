package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Recovers the crystal cap V2 discarded, from the economy's durable receipts. Only legacy rows
 * reach this class. The owning payout service serializes reconciliation and transfers, so a
 * reservation without a receipt is known not to have an in-flight transfer and may be retried.
 */
final class LegacyPayouts {

  private final Wallets wallets;
  private final MatchStore store;

  LegacyPayouts(Wallets wallets, MatchStore store) {
    this.wallets = wallets;
    this.store = store;
  }

  CompletableFuture<Void> reconcile(UUID player) {
    return store.legacyPayouts(player).thenCompose(rows -> receipts(player, rows));
  }

  private CompletableFuture<Void> receipts(UUID player, List<MatchStore.PlayerRow> rows) {
    CompletableFuture<List<MatchStore.LegacyPayment>> chain =
        CompletableFuture.completedFuture(new ArrayList<>());
    for (var row : rows) {
      chain =
          chain.thenCompose(
              payments ->
                  wallets
                      .receiptFor(PayoutService.key(row.matchId(), player))
                      .thenApply(
                          receipt -> {
                            if (receipt.isPresent()) {
                              payments.add(payment(row, receipt.orElseThrow()));
                            } else if (row.status() == MatchStore.PayoutStatus.PAID
                                && row.creditsPaid() != 0) {
                              throw new IllegalStateException(
                                  "paid legacy payout has no receipt: " + row.matchId());
                            }
                            return payments;
                          }));
    }
    return chain.thenCompose(payments -> store.reconcileLegacy(player, List.copyOf(payments)));
  }

  private static MatchStore.LegacyPayment payment(MatchStore.PlayerRow row, Receipt receipt) {
    if (!(receipt.from() instanceof AccountId.Server)
        || !receipt.to().equals(new AccountId.Player(row.player()))
        || receipt.amount().currency() != CurrencyId.CRYSTALS
        || receipt.amount().amount() <= 0
        || receipt.amount().amount() > row.creditsOwed()
        || !receipt.reason().equals(PayoutService.reason(row.matchId(), row.outcome()))) {
      throw new IllegalStateException("legacy payout receipt disagrees with " + row.matchId());
    }
    return new MatchStore.LegacyPayment(
        row.matchId(),
        LocalDate.ofInstant(receipt.at(), PayoutService.LEGACY_ZONE),
        receipt.amount().amount());
  }
}
