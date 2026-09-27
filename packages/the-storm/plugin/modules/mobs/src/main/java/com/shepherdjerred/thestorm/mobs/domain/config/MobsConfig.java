package com.shepherdjerred.thestorm.mobs.domain.config;

import com.shepherdjerred.thestorm.mobs.domain.level.LevelRules;
import com.shepherdjerred.thestorm.mobs.domain.scaling.Scaling;
import com.shepherdjerred.thestorm.mobs.domain.spawn.Exclusions;

/**
 * {@code plugins/TheStorm/mobs.yml}, owned by the repository.
 *
 * @param levels how a spawning mob's level is chosen
 * @param scaling how much a level strengthens a mob and its rewards
 * @param exclusions hostile mobs that are never levelled
 * @param adminRegions admin regions and what happens to hostile mobs in them
 * @param nameplate the "Lv N" name levelled mobs wear
 */
public record MobsConfig(
    LevelRules levels,
    Scaling scaling,
    Exclusions exclusions,
    AdminRegions adminRegions,
    Nameplate nameplate) {

  public MobsConfig {
    var highest = levels.cap();
    if (nameplate.colors().getLast().from() > highest) {
      throw new IllegalArgumentException("a nameplate color band starts above the level cap");
    }
  }
}
