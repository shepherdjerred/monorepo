package com.shepherdjerred.thestorm.towns.domain.claiming;

import com.shepherdjerred.thestorm.towns.domain.town.Town;

/**
 * How many chunks a town may hold. The server uses {@link ClaimAllowance}: a base plus a bonus for
 * the owner's Governor level.
 */
@FunctionalInterface
public interface ClaimLimits {

  int maxClaims(Town town);

  /** The same cap for every town. */
  static ClaimLimits flat(int max) {
    if (max < 1) {
      throw new IllegalArgumentException("a claim limit must be at least 1: " + max);
    }
    return town -> max;
  }
}
