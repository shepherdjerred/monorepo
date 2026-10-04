package com.shepherdjerred.thestorm.towns.domain.parcel;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/** A prepaid rental. Rights stop at the timestamp even if cleanup has not run. */
public record Lease(String parcelId, UUID owner, Instant paidThrough, State state) {

  public static final Duration WEEK = Duration.ofDays(7);
  public static final Duration GRACE = Duration.ofDays(7);

  public enum State {
    HELD,
    RESETTING
  }

  public boolean active(Instant now) {
    return state == State.HELD && now.isBefore(paidThrough);
  }

  public boolean reclaimable(Instant now) {
    return state == State.RESETTING || !now.isBefore(paidThrough.plus(GRACE));
  }

  public Lease renewed(Instant now) {
    if (reclaimable(now)) {
      throw new IllegalStateException("plot recovery has begun; the lease cannot be renewed");
    }
    var start = now.isAfter(paidThrough) ? now : paidThrough;
    return new Lease(parcelId, owner, start.plus(WEEK), State.HELD);
  }
}
