package com.shepherdjerred.thestorm.rwf.app;

import java.util.Optional;
import java.util.UUID;

/**
 * Main-thread operator port; stopping requires the exact bots-only showcase id. An empty start
 * refusal accepts the request: terrain and navigation activate asynchronously before its first
 * draft. A pending request blocks human admission and duplicate starts and can be stopped normally.
 */
public interface ShowcaseControl {
  /** Settles and prepares only this exact empty lobby's map, without drafting or reseeding. */
  Optional<String> prepare(UUID lobbyId);

  Optional<String> start(int combatants);

  /** Starts the exact empty lobby with a fixed domain seed; occupied lobbies are refused. */
  Optional<String> startSeeded(UUID lobbyId, int combatants, long seed);

  Optional<String> stop(UUID matchId);
}
