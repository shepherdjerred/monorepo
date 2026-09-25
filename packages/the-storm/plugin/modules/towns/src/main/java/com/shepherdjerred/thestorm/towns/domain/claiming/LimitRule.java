package com.shepherdjerred.thestorm.towns.domain.claiming;

import java.util.Optional;

/** A town may hold at most as many chunks as its {@link ClaimLimits} allow. */
final class LimitRule implements ClaimRule {

  private final ClaimLimits limits;

  LimitRule(ClaimLimits limits) {
    this.limits = limits;
  }

  @Override
  public Optional<ClaimProblem> check(ClaimAttempt attempt) {
    var limit = limits.maxClaims(attempt.town());
    return attempt.map().claimCount(attempt.town().id()) < limit
        ? Optional.empty()
        : Optional.of(new ClaimProblem.LimitReached(limit));
  }
}
