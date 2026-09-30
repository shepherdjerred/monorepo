package com.shepherdjerred.thestorm.skills.app;

import com.shepherdjerred.thestorm.skills.domain.Experience;
import com.shepherdjerred.thestorm.skills.domain.Skill;
import java.util.Map;

/** Immutable view of a player's progress in all eleven skills. */
public record SkillProgress(Map<Skill, Long> experience) {
  public SkillProgress {
    experience = Map.copyOf(experience);
  }

  public int level(Skill skill) {
    return Experience.level(experience.getOrDefault(skill, 0L));
  }

  public int powerLevel() {
    int total = 0;
    for (var skill : Skill.values()) {
      total += level(skill);
    }
    return total;
  }
}
