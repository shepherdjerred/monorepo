package com.shepherdjerred.thestorm.towns.domain.town;

import java.util.UUID;

/**
 * A player named in a command, with the name to use when telling others about them.
 *
 * @param id their id
 * @param name their last known name
 */
public record PlayerRef(UUID id, String name) {

  public PlayerRef {
    if (name.isBlank()) {
      throw new IllegalArgumentException("a player needs a name");
    }
  }
}
