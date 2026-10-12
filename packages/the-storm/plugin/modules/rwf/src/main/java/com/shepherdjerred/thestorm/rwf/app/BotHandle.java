package com.shepherdjerred.thestorm.rwf.app;

import java.util.UUID;

/**
 * A bot as the roster provider names it: the personality driving it and the UUID of the entity that
 * embodies it. The same pair the rules know as {@code CombatantId.Bot}, in app-level terms.
 *
 * @param personalityId which personality drives it
 * @param uuid the entity's UUID
 */
public record BotHandle(String personalityId, UUID uuid) {

  public BotHandle {
    if (personalityId.isBlank()) {
      throw new IllegalArgumentException("personalityId must not be blank");
    }
  }
}
