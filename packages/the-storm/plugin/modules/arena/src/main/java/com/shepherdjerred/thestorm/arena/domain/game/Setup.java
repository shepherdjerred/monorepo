package com.shepherdjerred.thestorm.arena.domain.game;

import com.shepherdjerred.thestorm.arena.domain.config.WaveTiming;
import com.shepherdjerred.thestorm.arena.domain.reward.RewardSettings;
import com.shepherdjerred.thestorm.arena.domain.wave.Difficulty;
import com.shepherdjerred.thestorm.arena.domain.wave.ResolvedWave;
import com.shepherdjerred.thestorm.arena.domain.wave.Scaling;
import com.shepherdjerred.thestorm.arena.domain.wave.Tier;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveTable;
import java.time.Duration;
import java.util.Map;
import java.util.TreeMap;

/**
 * Everything fixed about one arena's games.
 *
 * @param arenaId the arena's id
 * @param arenaName its display name
 * @param minPlayers the fewest ready players that start a game
 * @param maxPlayers the most players in a game
 * @param playerSpawns how many player spawns the arena has
 * @param countdown from everyone ready to the gates opening
 * @param timing the pace of waves and the entity cap
 * @param table the wave table
 * @param tier the arena's difficulty tier
 * @param scaling how mobs grow
 * @param rewards crystal rewards and vault milestones
 * @param classNames class id to display name, for every class
 */
public record Setup(
    String arenaId,
    String arenaName,
    int minPlayers,
    int maxPlayers,
    int playerSpawns,
    Duration countdown,
    WaveTiming timing,
    WaveTable table,
    Tier tier,
    Scaling scaling,
    RewardSettings rewards,
    Map<String, String> classNames) {

  public Setup {
    if (minPlayers < 1 || maxPlayers < minPlayers || playerSpawns < 1) {
      throw new IllegalArgumentException("need 1 <= minPlayers <= maxPlayers and a player spawn");
    }
    classNames = Map.copyOf(new TreeMap<>(classNames));
  }

  /** Wave {@code wave} scaled for {@code fighters} fighters. */
  ResolvedWave wave(int wave, int fighters) {
    return table.resolve(wave, new Difficulty(fighters, tier, scaling));
  }
}
