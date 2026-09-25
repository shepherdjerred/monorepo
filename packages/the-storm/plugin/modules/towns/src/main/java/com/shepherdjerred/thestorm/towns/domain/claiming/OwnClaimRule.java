package com.shepherdjerred.thestorm.towns.domain.claiming;

import java.util.Optional;

/** Unclaiming or changing a chunk needs the player's own town to hold it. */
final class OwnClaimRule implements ClaimRule {

  @Override
  public Optional<ClaimProblem> check(ClaimAttempt attempt) {
    var claim = attempt.map().claimAt(attempt.chunk());
    if (claim.isEmpty()) {
      return Optional.of(new ClaimProblem.NotClaimed());
    }
    var holder = claim.get().townId();
    return holder.equals(attempt.town().id())
        ? Optional.empty()
        : Optional.of(new ClaimProblem.OwnedByOtherTown(holder));
  }
}
