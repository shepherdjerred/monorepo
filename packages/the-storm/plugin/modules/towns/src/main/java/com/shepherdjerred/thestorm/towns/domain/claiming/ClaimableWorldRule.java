package com.shepherdjerred.thestorm.towns.domain.claiming;

import java.util.Optional;
import java.util.Set;

/** Claims are only made in the worlds the policy lists. */
final class ClaimableWorldRule implements ClaimRule {

  private final Set<String> worlds;

  ClaimableWorldRule(Set<String> worlds) {
    this.worlds = Set.copyOf(worlds);
  }

  @Override
  public Optional<ClaimProblem> check(ClaimAttempt attempt) {
    var world = attempt.chunk().world();
    return worlds.contains(world)
        ? Optional.empty()
        : Optional.of(new ClaimProblem.WorldNotClaimable(world));
  }
}
