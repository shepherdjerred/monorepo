package com.shepherdjerred.thestorm.skills.app;

import com.shepherdjerred.thestorm.skills.domain.Skill;
import java.util.UUID;

/**
 * A player's saved skill level rose.
 *
 * @param player who
 * @param skill which skill
 * @param from the level before
 * @param to the level now
 */
public record SkillLevelUp(UUID player, Skill skill, int from, int to) {

  public SkillLevelUp {
    if (from < 0 || to <= from) {
      throw new IllegalArgumentException("a level up rises: " + from + " -> " + to);
    }
  }
}
