package com.shepherdjerred.thestorm.towns.domain.claiming;

import java.util.Optional;

/**
 * A town's first claim may be anywhere; every later claim must share an edge with one it already
 * holds. Touching only at a corner does not count. A chunk someone already holds is left to {@link
 * UnclaimedRule}, so the player hears one reason, not two.
 */
final class AdjacentRule implements ClaimRule {

  @Override
  public Optional<ClaimProblem> check(ClaimAttempt attempt) {
    var town = attempt.town().id();
    if (attempt.map().claimCount(town) == 0 || attempt.map().claimAt(attempt.chunk()).isPresent()) {
      return Optional.empty();
    }
    var touches =
        attempt.chunk().edgeNeighbours().stream()
            .flatMap(neighbour -> attempt.map().claimAt(neighbour).stream())
            .anyMatch(claim -> claim.townId().equals(town));
    return touches ? Optional.empty() : Optional.of(new ClaimProblem.NotAdjacent());
  }
}
