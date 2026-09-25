package com.shepherdjerred.thestorm.towns.domain.claiming;

import java.util.Optional;

/** No chunk an admin region overlaps, even by one block, can be claimed. */
final class OutsideRegionsRule implements ClaimRule {

  @Override
  public Optional<ClaimProblem> check(ClaimAttempt attempt) {
    return attempt
        .map()
        .regionOverlapping(attempt.chunk())
        .map(region -> new ClaimProblem.InsideRegion(region.name()));
  }
}
