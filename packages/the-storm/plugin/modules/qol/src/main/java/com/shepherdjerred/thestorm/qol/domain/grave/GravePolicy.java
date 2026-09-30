package com.shepherdjerred.thestorm.qol.domain.grave;

import java.time.Duration;
import java.time.Instant;

/**
 * Who may open a grave and when it expires.
 *
 * <p>The owner may always empty their grave; what does not fit in their inventory falls at their
 * feet. For {@code lockedFor} after the death nobody else may open it. After that the grave is fair
 * game, as unlocked chests are under the server rules: anyone may take what fits in their
 * inventory, and the rest stays. At {@code expireAfter} the grave breaks and drops what is left.
 *
 * @param lockedFor how long only the owner may open the grave
 * @param expireAfter how long after the death the grave breaks open
 */
public record GravePolicy(Duration lockedFor, Duration expireAfter) {

  public GravePolicy {
    if (lockedFor.isNegative()) {
      throw new IllegalArgumentException("lockedFor must not be negative: " + lockedFor);
    }
    if (expireAfter.compareTo(lockedFor) <= 0) {
      throw new IllegalArgumentException(
          "expireAfter (" + expireAfter + ") must be longer than lockedFor (" + lockedFor + ")");
    }
  }

  /** Who is opening a grave. */
  public enum Opener {
    /** The player who died. */
    OWNER,
    /** Staff with the admin permission: never locked out, but not the owner either. */
    STAFF,
    /** Anyone else. */
    OTHER
  }

  /** What an opener may take. */
  public sealed interface Access {

    /** Everything; what does not fit falls at the opener's feet. */
    record Everything() implements Access {}

    /** What fits in the opener's inventory; the rest stays in the grave. */
    record WhatFits() implements Access {}

    /** Nothing yet: the grave is still locked to its owner for {@code remaining}. */
    record Locked(Duration remaining) implements Access {}
  }

  /** A grave's state, for listings. */
  public sealed interface Status {

    /** Only the owner may open it, for {@code remaining}. */
    record Locked(Duration remaining) implements Status {}

    /** Anyone may open it; it breaks open in {@code remaining}. */
    record Open(Duration remaining) implements Status {}

    /** It has expired and breaks open as soon as its chunk is loaded. */
    record Expired() implements Status {}
  }

  public Instant unlocksAt(Grave grave) {
    return grave.createdAt().plus(lockedFor);
  }

  public Instant expiresAt(Grave grave) {
    return grave.createdAt().plus(expireAfter);
  }

  public Access access(Grave grave, Opener opener, Instant now) {
    return switch (opener) {
      case OWNER -> new Access.Everything();
      case STAFF -> new Access.WhatFits();
      case OTHER -> {
        var unlocks = unlocksAt(grave);
        yield now.isBefore(unlocks)
            ? new Access.Locked(Duration.between(now, unlocks))
            : new Access.WhatFits();
      }
    };
  }

  public boolean isExpired(Grave grave, Instant now) {
    return !now.isBefore(expiresAt(grave));
  }

  public Status status(Grave grave, Instant now) {
    if (isExpired(grave, now)) {
      return new Status.Expired();
    }
    var unlocks = unlocksAt(grave);
    if (now.isBefore(unlocks)) {
      return new Status.Locked(Duration.between(now, unlocks));
    }
    return new Status.Open(Duration.between(now, expiresAt(grave)));
  }
}
