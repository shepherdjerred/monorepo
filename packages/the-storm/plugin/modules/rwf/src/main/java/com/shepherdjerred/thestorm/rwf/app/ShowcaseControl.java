package com.shepherdjerred.thestorm.rwf.app;

import java.util.Optional;
import java.util.UUID;

/** Main-thread operator port; stopping requires the exact bots-only showcase id. */
public interface ShowcaseControl {
  Optional<String> start(int combatants);

  /** Starts the exact empty lobby with a fixed domain seed; occupied lobbies are refused. */
  Optional<String> startSeeded(UUID lobbyId, int combatants, long seed);

  Optional<String> stop(UUID matchId);
}
