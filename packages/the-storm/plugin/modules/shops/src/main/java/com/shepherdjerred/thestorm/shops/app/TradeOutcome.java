package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeProblem;

/** How a trade ended. Only {@link Completed} moved anything for good. */
public sealed interface TradeOutcome {

  /** Crystals and items both moved. */
  record Completed(Receipt receipt) implements TradeOutcome {}

  /** Nothing moved. */
  record Refused(TradeProblem problem) implements TradeOutcome {}

  /** The payment went through but the items could not move, so it was paid back. */
  record Refunded(TradeProblem problem) implements TradeOutcome {}

  /**
   * The payment went through, the items could not move, and the ledger refused the refund. The
   * failure is logged for staff; items taken from the customer were given back.
   */
  record RefundFailed(TradeProblem problem, String why) implements TradeOutcome {}
}
