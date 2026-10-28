package com.shepherdjerred.thestorm.mechanics.domain.stargate;

import java.util.Set;
import java.util.UUID;
import java.util.function.Predicate;

/** Access to a Stargate network. Town membership is checked from current town state. */
public sealed interface NetworkAccess {

  /** Any player may use the network or add a gate if otherwise eligible. */
  record Public() implements NetworkAccess {}

  /** A network for its owner and the players the owner has invited. */
  record Private(UUID owner, Set<UUID> invited) implements NetworkAccess {
    public Private {
      invited = Set.copyOf(invited);
    }
  }

  /** A network for members of a particular town, identified independently of its name. */
  record Town(UUID townId) implements NetworkAccess {}

  /**
   * Whether a player may use or add gates to this network. {@code isMemberOfTown} checks the
   * supplied town id against current membership, not a cached gate permission.
   */
  default boolean permits(UUID player, Predicate<UUID> isMemberOfTown) {
    return switch (this) {
      case Public _ -> true;
      case Private(var owner, var invited) -> owner.equals(player) || invited.contains(player);
      case Town(var townId) -> isMemberOfTown.test(townId);
    };
  }

  /** Only the private network's owner may change its invitation list. */
  default boolean mayInvite(UUID player) {
    return this instanceof Private(var owner, _) && owner.equals(player);
  }
}
