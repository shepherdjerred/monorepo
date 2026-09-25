package com.shepherdjerred.thestorm.arena.domain.game;

/** Why a game refused a player's request. */
public enum GameError {
  /** The player is already in this arena. */
  ALREADY_JOINED,
  /** Waves are under way; the player can spectate instead. */
  IN_PROGRESS,
  /** The arena has as many players as it allows. */
  FULL,
  /** The player is not in this arena. */
  NOT_A_MEMBER,
  /** That can only be done in the lobby. */
  NOT_IN_LOBBY,
  /** There is no such class. */
  UNKNOWN_CLASS,
  /** The class is advanced and the player has not unlocked it. */
  CLASS_LOCKED,
  /** The player must pick a class first. */
  NO_CLASS,
  /** Nobody in the lobby has a class, or a game is already running. */
  NOTHING_TO_START,
}
