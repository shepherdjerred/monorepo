package com.shepherdjerred.thestorm.towns.domain.town;

import java.util.Optional;
import java.util.UUID;

/** A read-only view of the towns as they stand, which town rules check against. */
public interface TownDirectory {

  Optional<Town> townOf(UUID player);

  /** The town named {@code name}, ignoring case. */
  Optional<Town> named(String name);
}
