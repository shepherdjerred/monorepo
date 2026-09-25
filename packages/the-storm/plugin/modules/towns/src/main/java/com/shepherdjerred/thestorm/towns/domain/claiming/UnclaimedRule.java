package com.shepherdjerred.thestorm.towns.domain.claiming;

import java.util.Optional;

/** A chunk can only be claimed while nobody holds it. */
final class UnclaimedRule implements ClaimRule {

  @Override
  public Optional<ClaimProblem> check(ClaimAttempt attempt) {
    return attempt
        .map()
        .claimAt(attempt.chunk())
        .map(claim -> new ClaimProblem.AlreadyClaimed(claim.townId()));
  }
}
