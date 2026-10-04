// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/SearchAndDestroy.java
// and TeamBomb.java announcements); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.match;

/** Every announcement a match makes. Placeholders are filled from {@link Notice#values()}. */
public enum NoticeKind {
  /** "{player} joined" */
  JOINED,
  /** "{player} left" */
  LEFT,
  /** "Now using kit {kit}" */
  KIT_PICKED,
  /** "The game will begin in {seconds}" */
  COUNTDOWN,
  /** The countdown stopped because players left. */
  COUNTDOWN_CANCELLED,
  /** "The game has begun!" */
  GAME_BEGUN,
  /** "You are in {team}" */
  YOU_ARE_IN_TEAM,
  /** "There are {count} players in {team}" */
  TEAM_SIZE,
  /** "{team} just armed {owner}'s bomb!" */
  BOMB_ARMED,
  /** "{team} just armed a nuke!" */
  NUKE_ARMED,
  /** "{team} has just defused their bomb!" */
  BOMB_DEFUSED,
  /** "{team} has just defused {owner}'s nuke!" */
  NUKE_DEFUSED,
  /** "{seconds} left until {team}'s {bomb} goes off!" where bomb is "bomb" or "nuke" */
  FUSE_WARNING,
  /** "{team}'s bomb exploded!" */
  BOMB_EXPLODED,
  /** "{team}'s nuke exploded! Everyone but them annihilated!" */
  NUKE_EXPLODED,
  /** "{team} was defeated!" */
  TEAM_DEFEATED,
  /** "{player} is last man standing!" */
  LAST_MAN_STANDING,
  /** "One minute until players start dying!" */
  POISON_WARNING,
  /** "Don't say I didn't warn you!" */
  POISON_BEGUN,
  /** "{team} wins!" */
  TEAM_WINS,
  /** "No one won!" */
  DRAW,
  /** The match was stopped. */
  STOPPED,
  /** "Given {credits} credits" */
  CREDITS_GIVEN,
}
