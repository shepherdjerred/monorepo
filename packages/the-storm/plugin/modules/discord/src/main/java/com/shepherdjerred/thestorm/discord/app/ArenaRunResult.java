package com.shepherdjerred.thestorm.discord.app;

import java.util.List;

/**
 * A finished arena run, rendered by the Discord relay without depending on the arena module.
 *
 * @param arena the arena's display name
 * @param tier the arena's difficulty tier
 * @param players everyone who fought, with the furthest wave each reached
 * @param arenaRecord whether the run beat the arena's best wave
 */
public record ArenaRunResult(String arena, String tier, List<Player> players, boolean arenaRecord) {

  public ArenaRunResult {
    players = List.copyOf(players);
    if (players.isEmpty()) {
      throw new IllegalArgumentException("a run needs a player");
    }
  }

  /** The furthest wave anyone reached. */
  public int furthest() {
    return players.stream().mapToInt(Player::wave).max().orElseThrow();
  }

  /**
   * One fighter.
   *
   * @param name their name
   * @param wave the furthest wave they reached
   */
  public record Player(String name, int wave) {

    public Player {
      if (wave < 1) {
        throw new IllegalArgumentException("a fighter reaches wave 1 at least: " + wave);
      }
    }
  }
}
