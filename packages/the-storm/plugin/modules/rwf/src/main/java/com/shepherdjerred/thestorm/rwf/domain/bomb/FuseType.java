// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/FuseType.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.bomb;

/**
 * The bonus a Bomb Fuse may carry. Each level takes a second off the arm or defuse time: {@code
 * BOMB_SPEED} on both, the others only on their own action.
 */
public enum FuseType {
  BOMB_ARMING("Bomb Arming"),
  BOMB_DEFUSING("Bomb Defusing"),
  BOMB_SPEED("Bomb Speed");

  private final String loreName;

  FuseType(String loreName) {
    this.loreName = loreName;
  }

  /** The name Red Warfare wrote on the fuse's lore, followed by the level in Roman numerals. */
  public String loreName() {
    return loreName;
  }

  /** Whether this bonus counts for the action being performed. */
  public boolean appliesTo(BombAction action) {
    return switch (this) {
      case BOMB_SPEED -> true;
      case BOMB_ARMING -> action == BombAction.ARM;
      case BOMB_DEFUSING -> action == BombAction.DEFUSE;
    };
  }
}
