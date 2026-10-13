// Ported from libraryaddict's Red Warfare
// (redwarfare-global/src/me/libraryaddict/core/C.java and
// redwarfare-core/src/me/libraryaddict/core/data/TeamSettings.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;

/**
 * Red Warfare's chat colour codes, so kit messages keep the original's colours exactly, team
 * colours in the middle of a line included. The adapter renders them as Minecraft always has.
 */
public final class KitText {

  public static final String AQUA = "§b";
  public static final String BLUE = "§9";
  public static final String DARK_RED = "§4";
  public static final String GOLD = "§6";
  public static final String GREEN = "§a";
  public static final String MAGIC = "§k";
  public static final String RED = "§c";

  private KitText() {}

  /** A team's colour code, as Red Warfare's {@code GameTeam.getColoring()} gave it. */
  public static String team(TeamColor team) {
    return switch (team) {
      case BLUE -> BLUE;
      case GREEN -> "§2";
      case PURPLE -> "§5";
      case RED -> RED;
      case YELLOW -> "§e";
    };
  }
}
