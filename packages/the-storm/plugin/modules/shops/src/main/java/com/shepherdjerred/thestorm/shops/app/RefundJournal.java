package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import java.time.InstantSource;
import java.util.Optional;
import org.slf4j.Logger;

/** Records refunds the ledger refused, in the log and in storage, for staff to settle. */
public final class RefundJournal {

  private final ShopStore store;
  private final InstantSource time;
  private final Logger logger;

  public RefundJournal(ShopStore store, InstantSource time, Logger logger) {
    this.store = store;
    this.time = time;
    this.logger = logger;
  }

  /**
   * Records a trade the server shut down before it settled, with what the ledger had answered so
   * far. Only items actually taken from a selling customer and still held in escrow are kept in the
   * record for staff to settle according to the ledger outcome.
   */
  void unsettled(Deal deal, LedgerTrail trail) {
    var reason = "unsettled at shutdown: " + deal.reason() + " (" + trail.describe() + ")";
    var held =
        deal.direction() == Direction.SELL && trail.escrowHeld()
            ? Optional.of(new HeldItems(deal.goods(), deal.quantity()))
            : Optional.<HeldItems>empty();
    logger.error("Trade {} was still settling at shutdown: {}", deal.reason(), trail.describe());
    if (trail.hasCommittedRefund()) {
      if (held.isPresent()) {
        record(
            new RefundFailure(
                deal.payer().account(),
                deal.payee().account(),
                Crystals.ZERO,
                reason + "; refund committed: return held items only, do not transfer money",
                held,
                time.instant()));
      }
      return;
    }
    var paymentCommitted = trail.hasCommittedPayment();
    var payer = paymentCommitted ? deal.payee().account() : deal.payer().account();
    var payee = paymentCommitted ? deal.payer().account() : deal.payee().account();
    record(new RefundFailure(payer, payee, deal.price(), reason, held, time.instant()));
  }

  /**
   * Records that paying back {@code payment} failed.
   *
   * @param payment the original payment, which the refund would have reversed
   * @param reason the refund's ledger reason
   * @param why what the ledger said
   * @param held items the trade could not put anywhere, kept for staff
   */
  void failed(Receipt payment, String reason, String why, Optional<HeldItems> held) {
    logger.error(
        "Refund of {} from {} to {} for {} failed: {}; holding {}",
        payment.amount(),
        payment.to(),
        payment.from(),
        reason,
        why,
        held);
    record(
        new RefundFailure(
            payment.to(), payment.from(), payment.amount(), reason, held, time.instant()));
  }

  private void record(RefundFailure failure) {
    Background.logFailure(
        store.recordRefundFailure(failure), logger, "log the refund failure " + failure.reason());
  }
}
