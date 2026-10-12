package com.shepherdjerred.thestorm.discord.app;

import java.util.Optional;
import java.util.UUID;

/** Who wants their own results by direct message. Thread-safe. */
@FunctionalInterface
public interface Recipients {

  /** The Discord user to DM {@code player}'s results to, if they asked for them. */
  Optional<Long> dmTarget(UUID player);
}
