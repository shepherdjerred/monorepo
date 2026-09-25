package com.shepherdjerred.thestorm.towns.domain.claiming;

import java.util.Optional;

/** One check on a claim attempt. */
@FunctionalInterface
public interface ClaimRule {

  /** The problem with {@code attempt}, or empty when this rule is satisfied. */
  Optional<ClaimProblem> check(ClaimAttempt attempt);
}
