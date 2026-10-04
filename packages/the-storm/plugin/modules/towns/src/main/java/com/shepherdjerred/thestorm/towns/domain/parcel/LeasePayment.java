package com.shepherdjerred.thestorm.towns.domain.parcel;

import java.time.Instant;
import java.util.UUID;

/** A durable intention. The UUID is shared with the economy's idempotent transfer. */
public record LeasePayment(
    UUID operation, String parcelId, UUID owner, Instant paidThrough, long amount) {
  public Lease lease() {
    return new Lease(parcelId, owner, paidThrough, Lease.State.HELD);
  }
}
