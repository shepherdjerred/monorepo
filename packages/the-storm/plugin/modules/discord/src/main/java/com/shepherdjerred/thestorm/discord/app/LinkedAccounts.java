package com.shepherdjerred.thestorm.discord.app;

import java.util.Optional;
import java.util.UUID;

/** Discord accounts linked to players, as the relay reads them. Thread-safe. */
public interface LinkedAccounts {

  /** The Discord user to DM {@code player}'s results to, if they asked for them. */
  Optional<Long> dmTarget(UUID player);

  /** The player {@code discordUser} is linked to, if any. */
  Optional<UUID> playerOf(long discordUser);
}
