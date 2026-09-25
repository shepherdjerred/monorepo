package com.shepherdjerred.thestorm.arena.app;

import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;

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

  /**
   * Whether {@code location} lies in an arena where a game is under way. Players who are not in
   * that game may not teleport there (the arena refuses it); other modules can check first to
   * explain why.
   */
  boolean isGameRunningAt(Location location);
}
