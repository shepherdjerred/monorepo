package com.shepherdjerred.thestorm.rwf.app;

import static java.util.Objects.requireNonNull;

import java.util.Optional;
import java.util.UUID;

/** The bot population and difficulty frozen for one match's draft. */
public record BotDraftRequest(UUID matchId, int slots, Optional<BotDifficulty> difficulty) {
  public BotDraftRequest {
    requireNonNull(matchId);
    requireNonNull(difficulty);
    if (slots < 0) {
      throw new IllegalArgumentException("bot slots must not be negative");
    }
  }
}
