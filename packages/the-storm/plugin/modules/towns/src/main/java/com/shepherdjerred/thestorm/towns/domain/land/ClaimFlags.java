package com.shepherdjerred.thestorm.towns.domain.land;

import java.util.EnumSet;
import java.util.Set;

/**
 * The flags switched on for one claim; every flag not listed is off.
 *
 * @param enabled the flags that are on
 */
public record ClaimFlags(Set<ClaimFlag> enabled) {

  public ClaimFlags {
    enabled = Set.copyOf(enabled);
  }

  /** Every flag off: the most protective setting. */
  public static ClaimFlags none() {
    return new ClaimFlags(Set.of());
  }

  /** Only {@code flags} on. */
  public static ClaimFlags of(ClaimFlag... flags) {
    return new ClaimFlags(Set.of(flags));
  }

  public boolean has(ClaimFlag flag) {
    return enabled.contains(flag);
  }

  /** A copy with {@code flag} switched to {@code on}. */
  public ClaimFlags with(ClaimFlag flag, boolean on) {
    var next = enabled.isEmpty() ? EnumSet.noneOf(ClaimFlag.class) : EnumSet.copyOf(enabled);
    if (on) {
      next.add(flag);
    } else {
      next.remove(flag);
    }
    return new ClaimFlags(next);
  }
}
