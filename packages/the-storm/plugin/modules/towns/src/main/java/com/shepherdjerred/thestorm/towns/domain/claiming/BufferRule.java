package com.shepherdjerred.thestorm.towns.domain.claiming;

import java.util.Optional;

/**
 * No claim may come within {@code buffer} chunks (on both axes) of another town's claim, so towns
 * cannot wall each other in.
 */
final class BufferRule implements ClaimRule {

  private final int buffer;

  BufferRule(int buffer) {
    this.buffer = buffer;
  }

  @Override
  public Optional<ClaimProblem> check(ClaimAttempt attempt) {
    var town = attempt.town().id();
    return attempt.chunk().square(buffer).stream()
        .flatMap(chunk -> attempt.map().claimAt(chunk).stream())
        .filter(claim -> !claim.townId().equals(town))
        .findFirst()
        .map(claim -> new ClaimProblem.TooCloseToTown(claim.townId(), buffer));
  }
}
