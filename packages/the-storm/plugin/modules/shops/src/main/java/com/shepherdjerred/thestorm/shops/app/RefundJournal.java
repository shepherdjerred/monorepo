package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import java.time.InstantSource;
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
   * Records a trade the server shut down before it settled. Whether its payment went through is
   * unknown; any items taken from the customer were held in escrow and are gone with the process,
   * so staff check the ledger and settle it by hand.
   */
  void unsettled(Deal deal) {
    var reason =
        "unsettled at shutdown: "
            + deal.reason()
            + " ("
            + deal.quantity()
            + (deal.direction() == Direction.SELL ? " items in escrow)" : " items)");
    logger.error("Trade {} was still settling at shutdown", deal.reason());
    Background.logFailure(
        store.recordRefundFailure(
            new RefundFailure(
                deal.payer().account(),
                deal.payee().account(),
                deal.price(),
                reason,
                time.instant())),
        logger,
        "log the unsettled trade " + deal.reason());
  }

  /**
   * Records that paying back {@code payment} failed.
   *
   * @param payment the original payment, which the refund would have reversed
   * @param reason the refund's ledger reason
   * @param why what the ledger said
   */
  void failed(Receipt payment, String reason, String why) {
    logger.error(
        "Refund of {} from {} to {} for {} failed: {}",
        payment.amount(),
        payment.to(),
        payment.from(),
        reason,
        why);
    Background.logFailure(
        store.recordRefundFailure(
            new RefundFailure(
                payment.to(), payment.from(), payment.amount(), reason, time.instant())),
        logger,
        "log the failed refund for " + reason);
  }
}
