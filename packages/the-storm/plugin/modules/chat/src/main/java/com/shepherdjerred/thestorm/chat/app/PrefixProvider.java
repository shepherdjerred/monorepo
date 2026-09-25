package com.shepherdjerred.thestorm.chat.app;

import java.util.UUID;

/**
 * A player's chat prefix, such as their track title. The tracks module provides it (from LuckPerms
 * meta) through {@link PrefixRegistry}; until then players have no prefix.
 *
 * <p>The result is trusted MiniMessage, inserted into the chat format as is. Called from Paper's
 * async chat threads, so implementations must be thread-safe and must not block.
 */
@FunctionalInterface
public interface PrefixProvider {

  /** No prefix for anyone. */
  PrefixProvider NONE = player -> "";

  /** {@code player}'s prefix as MiniMessage, or an empty string for none. */
  String prefix(UUID player);
}
