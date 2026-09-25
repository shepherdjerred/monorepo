package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.economy.app.Receipt;
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
