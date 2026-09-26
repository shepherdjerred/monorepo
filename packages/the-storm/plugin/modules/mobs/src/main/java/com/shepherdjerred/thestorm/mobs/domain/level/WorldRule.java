package com.shepherdjerred.thestorm.mobs.domain.level;

/**
 * How one world levels its mobs. Worlds without a rule (the End) never level mobs.
 *
 * @param distanceScale multiplies the distance from the world spawn before the bands are read; the
 *     Nether uses 8 so its rings match the overworld's
 * @param depth whether mobs below the transition height gain depth levels
 * @param moon whether the moon phase adds levels at night
 */
public record WorldRule(double distanceScale, boolean depth, boolean moon) {

  public WorldRule {
    if (!(distanceScale > 0) || Double.isInfinite(distanceScale)) {
      throw new IllegalArgumentException("distanceScale must be positive: " + distanceScale);
    }
  }
}
