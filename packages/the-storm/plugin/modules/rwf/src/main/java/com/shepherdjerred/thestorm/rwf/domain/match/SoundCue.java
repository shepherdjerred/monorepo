// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/TeamBomb.java
// and SearchAndDestroy.java sounds); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.match;

/** The sounds a match asks the adapter to play. */
public enum SoundCue {
  /** Blaze death at pitch 0: your side's bomb was armed, or an enemy nuke was. */
  BOMB_ARMED_AGAINST_YOU,
  /** Lightning thunder: your side armed a bomb. */
  BOMB_ARMED_FOR_YOU,
  /** Blaze death at pitch 2: the fuse warning for the side the bomb threatens. */
  FUSE_WARNING,
  /** Creeper death at the bomb each second of the fuse. */
  FUSE_TICK,
  /** Fire extinguish at the bomb when a fuse is applied. */
  FUSE_HISS,
  /** Generic explosion at the bomb. */
  EXPLOSION,
  /** Creeper death at the countdown announcements. */
  COUNTDOWN,
  /** Note harp as the match goes live. */
  GAME_START,
}
