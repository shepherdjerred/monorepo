package com.shepherdjerred.thestorm.towns.domain.region;

/** Safety is independent of a player's permission to edit or use a region. */
public enum RegionProfile {
  /** Public arrivals: no player damage or natural changes to the preserved build. */
  SAFE,
  /** Games keep their own damage rules while the surrounding build remains protected. */
  ARENA,
  /** Preserved buildings allow ordinary survival damage. */
  PRESERVE;

  public boolean preventsPlayerDamage() {
    return this == SAFE;
  }
}
