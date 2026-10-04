// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/TeamBomb.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.bomb;

/** Why a click on a bomb did nothing. */
public enum BombError {
  /** "You cannot arm your own bomb!" */
  CANNOT_ARM_OWN_BOMB,
  /** "You cannot disarm the enemies bomb!" */
  CANNOT_DEFUSE_ENEMY_BOMB,
  /** "You cannot disarm your team's nuke!" */
  CANNOT_DEFUSE_OWN_NUKE,
  /** The bomb has exploded or been removed. */
  DESTROYED,
}
