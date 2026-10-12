// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/data/TeamSettings.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.combatant;

/**
 * The teams a map may field. Red Warfare's {@code PLAYER} pseudo-team marks nukes in map data and
 * is not a team; see {@code BombOwner.Nuke}.
 */
public enum TeamColor {
  RED("Red Team", "Red"),
  BLUE("Blue Team", "Blue"),
  GREEN("Green Team", "Green"),
  PURPLE("Purple Team", "Purple"),
  YELLOW("Yellow Team", "Yellow");

  private final String displayName;
  private final String shortName;

  TeamColor(String displayName, String shortName) {
    this.displayName = displayName;
    this.shortName = shortName;
  }

  public String displayName() {
    return displayName;
  }

  public String shortName() {
    return shortName;
  }
}
