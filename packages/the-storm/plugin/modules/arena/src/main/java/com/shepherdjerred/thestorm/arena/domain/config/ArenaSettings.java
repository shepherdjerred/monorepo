package com.shepherdjerred.thestorm.arena.domain.config;

import com.shepherdjerred.thestorm.arena.domain.reward.LootTable;
import com.shepherdjerred.thestorm.arena.domain.reward.RewardSettings;
import com.shepherdjerred.thestorm.arena.domain.wave.Scaling;
import com.shepherdjerred.thestorm.arena.domain.wave.Tier;
import java.time.Duration;
import java.util.List;

/**
 * {@code arena.yml}: the rules every arena shares.
 *
 * @param countdown from everyone being ready to the gates opening
 * @param waves the pace of a game and the entity cap
 * @param scaling how mobs grow with the wave and the number of fighters
 * @param tiers the difficulty tiers, Ominous I first; an arena names its tier by number
 * @param rewards crystal rewards and the vault milestones
 * @param lootChests what the hidden loot chests hold, rolled per chest when a game starts
 * @param messages the announcements
 */
public record ArenaSettings(
    Duration countdown,
    WaveTiming waves,
    Scaling scaling,
    List<Tier> tiers,
    RewardSettings rewards,
    LootTable lootChests,
    Messages messages) {

  public ArenaSettings {
    if (countdown.isNegative() || countdown.compareTo(Duration.ofMinutes(5)) > 0) {
      throw new IllegalArgumentException("countdown must be 0 to 5 minutes: " + countdown);
    }
    if (tiers.isEmpty() || tiers.size() > 10) {
      throw new IllegalArgumentException("there must be 1 to 10 tiers: " + tiers.size());
    }
    messages.check();
    tiers = List.copyOf(tiers);
  }

  /** Tier {@code number}, counting Ominous I as 1. */
  public Tier tier(int number) {
    if (number < 1 || number > tiers.size()) {
      throw new IllegalArgumentException("tier must be 1 to " + tiers.size() + ": " + number);
    }
    return tiers.get(number - 1);
  }
}
