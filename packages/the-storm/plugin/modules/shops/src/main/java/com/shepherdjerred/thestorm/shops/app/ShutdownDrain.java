package com.shepherdjerred.thestorm.shops.app;

import java.time.Duration;

/**
 * Lets trades in flight settle when the module stops. The main thread runs their queued
 * continuations itself for a bounded time; any trade still unsettled after that is written to the
 * refund-failure log for staff and its locks released.
 */
public final class ShutdownDrain {

  private final MainThreadPump pump;
  private final ShopLocks locks;
  private final RefundJournal journal;

  public ShutdownDrain(MainThreadPump pump, ShopLocks locks, RefundJournal journal) {
    this.pump = pump;
    this.locks = locks;
    this.journal = journal;
  }

  /**
   * Main thread, while the module disables. Blocks for at most {@code timeout}.
   *
   * @return how many trades could not settle and were logged for staff
   */
  public int drain(Duration timeout) {
    pump.runUntil(locks::idle, timeout);
    var unsettled = locks.held();
    for (var lease : unsettled) {
      journal.unsettled(lease.deal());
      lease.release();
    }
    return unsettled.size();
  }
}
