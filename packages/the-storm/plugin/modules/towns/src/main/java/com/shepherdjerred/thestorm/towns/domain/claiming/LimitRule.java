package com.shepherdjerred.thestorm.towns.domain.claiming;

import java.util.Optional;

/** A town may hold at most {@code limit} chunks. */
final class LimitRule implements ClaimRule {

  private final int limit;

  LimitRule(int limit) {
    this.limit = limit;
  }

  @Override
  public Optional<ClaimProblem> check(ClaimAttempt attempt) {
    return attempt.map().claimCount(attempt.town().id()) < limit
        ? Optional.empty()
        : Optional.of(new ClaimProblem.LimitReached(limit));
  }
}
