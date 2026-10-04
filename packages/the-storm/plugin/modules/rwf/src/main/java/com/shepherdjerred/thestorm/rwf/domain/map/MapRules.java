// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/managers/WorldManager.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.map;

import java.util.List;
import java.util.Optional;

/** Rules about which maps may be played. */
public final class MapRules {

  /** Below this many players a map with more than two teams is not played. */
  public static final int PLAYERS_FOR_MANY_TEAMS = 20;

  private MapRules() {}

  /** Whether {@code map} may be played by {@code players} players. */
  public static boolean fitsPlayerCount(MapDefinition map, int players) {
    return players >= PLAYERS_FOR_MANY_TEAMS || map.teams().size() <= 2;
  }

  /**
   * The map to play given the vote order: the winner, unless it has too many teams for the player
   * count, in which case the best-placed two-team map, or the winner anyway when there is none.
   */
  public static Optional<MapDefinition> choose(List<MapDefinition> voteOrder, int players) {
    if (voteOrder.isEmpty()) {
      return Optional.empty();
    }
    var winner = voteOrder.getFirst();
    if (fitsPlayerCount(winner, players)) {
      return Optional.of(winner);
    }
    return Optional.of(
        voteOrder.stream().filter(map -> map.teams().size() <= 2).findFirst().orElse(winner));
  }
}
