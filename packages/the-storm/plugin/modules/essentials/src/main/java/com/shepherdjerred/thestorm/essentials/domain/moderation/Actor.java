package com.shepherdjerred.thestorm.essentials.domain.moderation;

import java.util.Optional;
import java.util.UUID;

/**
 * Who took a moderation action.
 *
 * @param uuid the staff member, or empty for the console
 * @param name their name at the time, or {@code Console}
 */
public record Actor(Optional<UUID> uuid, String name) {

  /** The server console. */
  public static final Actor CONSOLE = new Actor(Optional.empty(), "Console");

  public Actor {
    if (name.isBlank()) {
      throw new IllegalArgumentException("actor name must not be blank");
    }
  }

  /** A player acting as staff. */
  public static Actor player(UUID uuid, String name) {
    return new Actor(Optional.of(uuid), name);
  }
}
