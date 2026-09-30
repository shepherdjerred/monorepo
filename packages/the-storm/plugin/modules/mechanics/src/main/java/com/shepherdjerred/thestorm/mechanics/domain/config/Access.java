package com.shepherdjerred.thestorm.mechanics.domain.config;

/**
 * Who may build and use a sign mechanism.
 *
 * @param enabled whether the mechanism works at all; switched-off signs are refused on creation and
 *     do nothing when used
 * @param level the Mechanic track level (1 to 5) needed to create the sign
 * @param useLevel the Mechanic track level needed to use it, or 0 for everyone
 */
public record Access(boolean enabled, int level, int useLevel) {

  public Access {
    Checks.range("level", level, 1, Checks.MAX_LEVEL);
    Checks.range("useLevel", useLevel, 0, level);
  }
}
