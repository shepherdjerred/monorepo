package com.shepherdjerred.thestorm.towns.domain.town;

import java.time.Instant;

/**
 * What a sweep should do with one camp. A member who is online refreshes the clock. Otherwise the
 * camp warns once inside the warning window, then lapses when the idle time has passed.
 */
public final class CampClock {

  /** What the sweep should do. */
  public enum Action {
    /** Leave the stored clock as it is. */
    NONE,
    /** A member is online, so the idle clock starts again. */
    REFRESH,
    /** Tell online members that the camp is close to lapsing. */
    WARN,
    /** Remove the camp and release its claims. */
    LAPSE
  }

  private CampClock() {}

  /**
   * The action for {@code camp} at {@code now}. {@code anyoneOnline} is true when one of its
   * members is on the server.
   */
  public static Action decide(Town camp, Instant now, boolean anyoneOnline, CampPolicy policy) {
    if (!camp.isCamp()) {
      return Action.NONE;
    }
    if (anyoneOnline) {
      return Action.REFRESH;
    }
    var lapseAt = camp.lastActive().orElseGet(camp::createdAt).plus(policy.idle());
    if (!now.isBefore(lapseAt)) {
      return Action.LAPSE;
    }
    var warnAt = lapseAt.minus(policy.warn());
    return !now.isBefore(warnAt) && !camp.expiryWarned() ? Action.WARN : Action.NONE;
  }
}
