package com.shepherdjerred.thestorm.rwf.domain.combatant;

import java.util.UUID;

/** Someone who can fight in a match: a real player, or a bot driven by a personality. */
public sealed interface CombatantId {

  /** The entity's UUID; for a bot, the UUID of the entity that embodies it. */
  UUID uuid();

  default boolean isBot() {
    return this instanceof Bot;
  }

  /**
   * A real player.
   *
   * @param uuid the player's UUID
   */
  record Human(UUID uuid) implements CombatantId {}

  /**
   * A bot.
   *
   * @param personalityId which personality drives it
   * @param uuid the entity's UUID
   */
  record Bot(String personalityId, UUID uuid) implements CombatantId {

    public Bot {
      if (personalityId.isBlank()) {
        throw new IllegalArgumentException("personalityId must not be blank");
      }
    }
  }
}
