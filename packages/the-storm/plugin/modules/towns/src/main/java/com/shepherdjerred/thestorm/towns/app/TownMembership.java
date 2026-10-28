package com.shepherdjerred.thestorm.towns.app;

import java.util.Optional;
import java.util.UUID;

/** Current town membership, read on the main thread. */
@FunctionalInterface
public interface TownMembership {
  /** The town a player currently belongs to. */
  Optional<UUID> townIdOf(UUID player);

  /** Whether the player is currently a member of the identified town. */
  default boolean isMember(UUID player, UUID townId) {
    return townIdOf(player).filter(townId::equals).isPresent();
  }
}
