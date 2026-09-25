package com.shepherdjerred.thestorm.towns.domain.claiming;

import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlags;
import java.util.Set;

/**
 * How towns may claim land, from {@code towns.yml}.
 *
 * @param worlds the worlds claims may be made in, by name
 * @param buffer how many chunks must separate one town's claims from another's
 * @param maxClaimsPerTown the most chunks one town may hold
 * @param defaultFlags the flags a new claim starts with
 */
public record ClaimPolicy(
    Set<String> worlds, int buffer, int maxClaimsPerTown, Set<ClaimFlag> defaultFlags) {

  /** The largest buffer allowed, so a buffer check stays cheap. */
  public static final int MAX_BUFFER = 16;

  public ClaimPolicy {
    worlds = Set.copyOf(worlds);
    defaultFlags = Set.copyOf(defaultFlags);
    if (worlds.isEmpty()) {
      throw new IllegalArgumentException("list at least one claimable world");
    }
    if (worlds.stream().anyMatch(String::isBlank)) {
      throw new IllegalArgumentException("world names must not be blank");
    }
    if (buffer < 0 || buffer > MAX_BUFFER) {
      throw new IllegalArgumentException("buffer must be between 0 and " + MAX_BUFFER);
    }
    if (maxClaimsPerTown < 1) {
      throw new IllegalArgumentException("maxClaimsPerTown must be at least 1");
    }
  }

  public ClaimFlags newClaimFlags() {
    return new ClaimFlags(defaultFlags);
  }
}
