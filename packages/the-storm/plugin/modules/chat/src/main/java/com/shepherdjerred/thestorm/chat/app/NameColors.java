package com.shepherdjerred.thestorm.chat.app;

import java.util.Optional;
import java.util.UUID;

/**
 * Colours a speaker's name as each viewer sees it, such as a match's team colours, where a
 * disguised player shows in each viewer's own colour. A module provides it through {@link
 * ChannelRegistry}; until then names keep the channel format's colour.
 *
 * <p>Called from Paper's async chat threads, once per viewer, so implementations must be
 * thread-safe and must not block.
 */
@FunctionalInterface
public interface NameColors {

  /** Nobody's name is coloured. */
  NameColors NONE = (speaker, viewer) -> Optional.empty();

  /**
   * The colour of {@code speaker}'s name as {@code viewer} sees it, as a MiniMessage colour name
   * such as {@code dark_green}, or empty to leave it as the format has it.
   */
  Optional<String> color(UUID speaker, UUID viewer);
}
