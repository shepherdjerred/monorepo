package com.shepherdjerred.thestorm.tracks.app;

import java.util.Locale;

/** The five progression tracks. */
public enum Track {
  SHOPKEEPER,
  MECHANIC,
  ENGINEER,
  SPELLCASTER,
  GOVERNOR;

  /** The highest level in every track. */
  public static final int MAX_LEVEL = 5;

  /** A stable lowercase id, used in config, permissions and storage. */
  public String id() {
    return name().toLowerCase(Locale.ROOT);
  }

  /**
   * The permission a player holds once they reach {@code level} in this track, for example {@code
   * thestorm.track.mechanic.3}. Reaching a level grants every lower level's permission too.
   */
  public String permission(int level) {
    if (level < 1 || level > MAX_LEVEL) {
      throw new IllegalArgumentException("track level must be 1.." + MAX_LEVEL + ": " + level);
    }
    return "thestorm.track." + id() + "." + level;
  }
}
