package com.shepherdjerred.thestorm.arena.app;

import java.util.Optional;
import java.util.UUID;

/**
 * Who is in an arena. Other modules use it to keep arena players out of their features (for
 * example, no teleport requests or trades from inside a game). Obtain it with {@code
 * context.services().require(ArenaPresence.class)}. Main thread only.
 */
public interface ArenaPresence {

  /**
   * The id of the arena {@code player} is in, whether joining, in the lobby, fighting or watching;
   * empty if they are in none.
   */
  Optional<String> arenaOf(UUID player);
}
