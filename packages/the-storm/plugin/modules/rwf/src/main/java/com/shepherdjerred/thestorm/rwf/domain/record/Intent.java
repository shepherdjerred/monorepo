package com.shepherdjerred.thestorm.rwf.domain.record;

/**
 * What a bot (or a tracked human) was trying to do, for training and review.
 *
 * @param tick ticks since the match went live
 * @param pseudonym who
 * @param kind a short kind such as {@code attack}, {@code arm}, {@code defuse}, {@code retreat}
 * @param target the pseudonym, bomb id or spot it was aimed at; may be empty
 */
public record Intent(long tick, String pseudonym, String kind, String target) {

  public Intent {
    if (tick < 0) {
      throw new IllegalArgumentException("tick must not be negative");
    }
    if (!RosterEntry.PSEUDONYM.matcher(pseudonym).matches()) {
      throw new IllegalArgumentException("pseudonym must be short lower-case alphanumeric");
    }
    if (kind.isBlank()) {
      throw new IllegalArgumentException("kind must not be blank");
    }
  }
}
