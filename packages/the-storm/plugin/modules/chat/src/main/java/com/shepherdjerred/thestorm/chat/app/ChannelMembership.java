package com.shepherdjerred.thestorm.chat.app;

import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Resolves who hears a message in a membership channel (town, match team, the dead). Provided by
 * the module that owns the group through {@link ChannelRegistry}.
 *
 * <p>Called from Paper's async chat threads as well as the main thread, so implementations must be
 * thread-safe and must not block or touch world state.
 */
@FunctionalInterface
public interface ChannelMembership {

  /**
   * Everyone in {@code speaker}'s group, including the speaker, or empty when the speaker has none.
   */
  Optional<Set<UUID>> members(UUID speaker);
}
