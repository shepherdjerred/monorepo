// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/FuseType.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.bomb;

/**
 * A levelled bonus on a Bomb Fuse, such as {@code Bomb Arming X} given to the last man standing.
 *
 * @param type what the bonus speeds up
 * @param level seconds taken off, 1 to 10
 */
public record FuseBonus(FuseType type, int level) {

  /** The level that arms a bomb instantly, given to a team's last living member. */
  public static final int INSTANT = 10;

  public FuseBonus {
    if (level < 1 || level > INSTANT) {
      throw new IllegalArgumentException("fuse level must be 1-" + INSTANT + ": " + level);
    }
  }

  /** Seconds this bonus takes off {@code action}. */
  public int secondsOff(BombAction action) {
    return type.appliesTo(action) ? level : 0;
  }
}
