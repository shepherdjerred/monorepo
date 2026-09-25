package com.shepherdjerred.thestorm.towns.domain.protection;

import java.util.UUID;

/** Why an act was refused, for the message the player sees. */
public sealed interface Denial {

  /** The land belongs to a town that does not let this player do that. */
  record ByTown(UUID townId, Action action) implements Denial {}

  /** The land is an admin region that does not allow that. */
  record ByRegion(String regionName, Action action) implements Denial {}

  /** PvP is off where the attacker or the victim stands. */
  record NoPvp() implements Denial {}
}
