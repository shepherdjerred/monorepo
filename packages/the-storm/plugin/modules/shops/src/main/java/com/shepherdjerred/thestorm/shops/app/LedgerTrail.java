package com.shepherdjerred.thestorm.shops.app;

import java.util.ArrayList;
import java.util.List;

/**
 * What the ledger has answered so far for one trade: its payment and any refund. A trade the server
 * shut down before it settled is logged with this, so staff know whether money moved. Written from
 * the database thread, read on the main thread.
 */
public final class LedgerTrail {

  private final List<String> events = new ArrayList<>();

  synchronized void record(String event) {
    events.add(event);
  }

  /** The ledger's answers in order, or a note that none has arrived. */
  public synchronized String describe() {
    return events.isEmpty()
        ? "no ledger answer yet, so whether the payment committed is unknown"
        : String.join("; ", events);
  }
}
