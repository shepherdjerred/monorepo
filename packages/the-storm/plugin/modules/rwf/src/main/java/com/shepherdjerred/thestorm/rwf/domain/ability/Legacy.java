// Ported from libraryaddict's Red Warfare
// (redwarfare-global/src/me/libraryaddict/core/C.java and
// redwarfare-core/src/me/libraryaddict/core/data/TeamSettings.java, the team colours); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;

/**
 * Red Warfare's chat colour codes ({@code C}), so a kit's messages read exactly as they did. Text
 * built from these is sent with {@link AbilityEffect.Tone#LEGACY}.
 */
public final class Legacy {

  public static final String AQUA = "§b";
  public static final String BLUE = "§9";
  public static final String BOLD = "§l";
  public static final String DARK_AQUA = "§3";
  public static final String DARK_RED = "§4";
  public static final String GOLD = "§6";
  public static final String GRAY = "§7";
  public static final String GREEN = "§a";
  public static final String MAGIC = "§k";
  public static final String RED = "§c";
  public static final String YELLOW = "§e";

  private Legacy() {}

  /** The colour Red Warfare's {@code GameTeam.getColoring} gave {@code team}. */
  public static String team(TeamColor team) {
    return switch (team) {
      case RED -> RED;
      case BLUE -> BLUE;
      case GREEN -> "§2";
      case PURPLE -> "§5";
      case YELLOW -> YELLOW;
    };
  }
}
