package com.shepherdjerred.thestorm.skills.app;

import com.shepherdjerred.thestorm.skills.domain.Experience;
import com.shepherdjerred.thestorm.skills.domain.Skill;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/** Immutable view of a player's progress in all eleven skills. */
public record SkillProgress(Map<Skill, Long> experience) {
  public SkillProgress {
    experience = Map.copyOf(experience);
  }

  public int level(Skill skill) {
    return Experience.level(experience.getOrDefault(skill, 0L));
  }

  /** Every skill id and the level already saved. Ids are lowercase skill names. */
  public Map<String, Integer> levels() {
    var levels = new LinkedHashMap<String, Integer>();
    for (var skill : Skill.values()) {
      levels.put(skill.name().toLowerCase(Locale.ROOT), level(skill));
    }
    return Map.copyOf(levels);
  }

  public int powerLevel() {
    int total = 0;
    for (var skill : Skill.values()) {
      total += level(skill);
    }
    return total;
  }
}
