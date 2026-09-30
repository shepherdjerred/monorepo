package com.shepherdjerred.thestorm.towns.domain.claiming;

import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.Optional;

/** Removing a bridge must not split a town's edge-connected land. */
final class ConnectedRemovalRule implements ClaimRule {

  @Override
  public Optional<ClaimProblem> check(ClaimAttempt attempt) {
    var map = attempt.map();
    var town = attempt.town().id();
    if (map.claimAt(attempt.chunk()).filter(claim -> claim.townId().equals(town)).isEmpty()) {
      return Optional.empty();
    }
    var remaining = map.claimCount(town) - 1;
    if (remaining == 0) {
      return Optional.empty();
    }
    var queue = new ArrayDeque<ChunkPos>();
    firstNeighbor(attempt).ifPresent(queue::add);
    return reachable(attempt, queue) == remaining
        ? Optional.empty()
        : Optional.of(new ClaimProblem.WouldDisconnect());
  }

  private static Optional<ChunkPos> firstNeighbor(ClaimAttempt attempt) {
    var town = attempt.town().id();
    return attempt.chunk().edgeNeighbours().stream()
        .filter(
            neighbour ->
                attempt
                    .map()
                    .claimAt(neighbour)
                    .filter(claim -> claim.townId().equals(town))
                    .isPresent())
        .findFirst();
  }

  private static int reachable(ClaimAttempt attempt, ArrayDeque<ChunkPos> queue) {
    var map = attempt.map();
    var town = attempt.town().id();
    var visited = new HashSet<ChunkPos>();
    while (!queue.isEmpty()) {
      var chunk = queue.removeFirst();
      if (chunk.equals(attempt.chunk()) || !visited.add(chunk)) {
        continue;
      }
      for (var neighbour : chunk.edgeNeighbours()) {
        if (!neighbour.equals(attempt.chunk())
            && !visited.contains(neighbour)
            && map.claimAt(neighbour).filter(claim -> claim.townId().equals(town)).isPresent()) {
          queue.addLast(neighbour);
        }
      }
    }
    return visited.size();
  }
}
