package com.shepherdjerred.thestorm.towns.domain.land;

import java.util.UUID;

/** Who owns protected land: a player town or an administrator-defined region. */
public sealed interface Owner {

  /** Land a town has claimed. */
  record OfTown(UUID townId) implements Owner {}

  /** Land inside an admin region such as spawn or the arena. */
  record OfRegion(String regionId) implements Owner {}
}
