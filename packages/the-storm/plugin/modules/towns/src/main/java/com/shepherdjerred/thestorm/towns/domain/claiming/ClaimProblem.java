package com.shepherdjerred.thestorm.towns.domain.claiming;

import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
import java.util.UUID;

/** Why a claim, unclaim or flag change was refused. */
public sealed interface ClaimProblem {

  /** The player is not in a town. */
  record NotInTown() implements ClaimProblem {}

  /** The player's role may not manage claims. */
  record CannotManageClaims(TownRole role) implements ClaimProblem {}

  /** Claims are not allowed in this world. */
  record WorldNotClaimable(String world) implements ClaimProblem {}

  /** An admin region overlaps the chunk. */
  record InsideRegion(String regionName) implements ClaimProblem {}

  /** A town already holds the chunk. */
  record AlreadyClaimed(UUID townId) implements ClaimProblem {}

  /** The chunk shares no edge with the town's existing claims. */
  record NotAdjacent() implements ClaimProblem {}

  /** Another town's claim is within the buffer. */
  record TooCloseToTown(UUID townId, int buffer) implements ClaimProblem {}

  /** The town holds as many chunks as it may. */
  record LimitReached(int limit) implements ClaimProblem {}

  /** Nobody holds the chunk. */
  record NotClaimed() implements ClaimProblem {}

  /** Another town holds the chunk. */
  record OwnedByOtherTown(UUID townId) implements ClaimProblem {}

  /** A change to this town or chunk is still being saved. */
  record Busy() implements ClaimProblem {}
}
