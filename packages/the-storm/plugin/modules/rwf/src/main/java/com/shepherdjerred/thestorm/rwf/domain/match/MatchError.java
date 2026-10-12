package com.shepherdjerred.thestorm.rwf.domain.match;

/** Why a match refused a request. */
public enum MatchError {
  /** The combatant is already in the match. */
  ALREADY_JOINED,
  /** The match is under way or ending; nobody can join. */
  IN_PROGRESS,
  /** The match has as many players as it allows. */
  FULL,
  /** The combatant is not in the match. */
  NOT_A_MEMBER,
  /** That can only be done before the match starts. */
  NOT_PRE_GAME,
  /** There is no such kit. */
  UNKNOWN_KIT,
  /** No map has been chosen. */
  NO_MAP,
  /** The map cannot change once the match has started. */
  MAP_LOCKED,
  /** Too few players to start. */
  TOO_FEW_PLAYERS,
  /** The match is not live. */
  NOT_LIVE,
  /** The combatant is not alive. */
  NOT_ALIVE,
  /** There is no such bomb on this map. */
  UNKNOWN_BOMB,
  /** The bomb has exploded or been removed. */
  BOMB_DESTROYED,
  /** "You cannot arm your own bomb!" */
  CANNOT_ARM_OWN_BOMB,
  /** "You cannot disarm the enemies bomb!" */
  CANNOT_DEFUSE_ENEMY_BOMB,
  /** "You cannot disarm your team's nuke!" */
  CANNOT_DEFUSE_OWN_NUKE,
  /** The match is not resetting. */
  NOT_RESETTING,
  /** The match is already resetting. */
  ALREADY_RESETTING,
}
