package com.shepherdjerred.thestorm.rwf.app;

import java.util.Optional;
import java.util.UUID;

/** Main-thread operator port; stopping requires the exact bots-only showcase id. */
public interface ShowcaseControl {
  Optional<String> start(int combatants);

  Optional<String> stop(UUID matchId);
}
