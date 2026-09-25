package com.shepherdjerred.thestorm.qol.domain.grave;

import java.time.Instant;
import java.util.UUID;

/** Opening a grave before it spills. */
public final class GraveAccess {

  private GraveAccess() {}

  /** What an open attempt does. */
  public enum Open {
    OWNER,
    DENIED,
    EXPIRED
  }

  /** {@code opener} at {@code now}, for a grave owned by {@code owner} until {@code expires}. */
  public static Open open(UUID opener, UUID owner, Instant now, Instant expires) {
    if (!now.isBefore(expires)) {
      return Open.EXPIRED;
    }
    if (opener.equals(owner)) {
      return Open.OWNER;
    }
    return Open.DENIED;
  }
}
