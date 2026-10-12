package com.shepherdjerred.thestorm.rwfbots.domain.director;

/** Maps between a personality's skill in 0..1 and the OpenSkill mean. */
public final class SkillScale {

  /** The mean of a skill-0 bot. */
  public static final double MU_FLOOR = 10;

  /** The mean of a skill-1 bot. */
  public static final double MU_CEILING = 40;

  private SkillScale() {}

  public static double toMu(double skill) {
    if (!(skill >= 0 && skill <= 1)) {
      throw new IllegalArgumentException("skill must be 0..1: " + skill);
    }
    return MU_FLOOR + (MU_CEILING - MU_FLOOR) * skill;
  }

  /** The skill whose mean is {@code mu}, clamped to 0..1. */
  public static double toSkill(double mu) {
    return Math.clamp((mu - MU_FLOOR) / (MU_CEILING - MU_FLOOR), 0, 1);
  }
}
