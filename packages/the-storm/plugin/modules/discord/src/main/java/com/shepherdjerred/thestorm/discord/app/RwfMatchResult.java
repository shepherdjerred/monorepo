package com.shepherdjerred.thestorm.discord.app;

import java.time.Duration;
import java.util.List;
import java.util.Optional;

/**
 * A finished Search and Destroy match, rendered by the Discord relay without depending on the rwf
 * module. Only human players are listed.
 *
 * @param map the map's display name
 * @param winningTeam the winning team's display name; empty for a draw
 * @param winners the humans on the winning team; empty for a draw
 * @param players every human who finished the match
 * @param length how long the match was live
 */
public record RwfMatchResult(
    String map,
    Optional<String> winningTeam,
    List<String> winners,
    List<String> players,
    Duration length) {

  public RwfMatchResult {
    winners = List.copyOf(winners);
    players = List.copyOf(players);
    if (winningTeam.isEmpty() && !winners.isEmpty()) {
      throw new IllegalArgumentException("a draw has no winners: " + winners);
    }
  }
}
