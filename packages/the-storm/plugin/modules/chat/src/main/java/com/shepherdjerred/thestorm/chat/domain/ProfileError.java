package com.shepherdjerred.thestorm.chat.domain;

/** Why a change to a player's chat profile was refused. */
public enum ProfileError {
  /** The channel is the one the player talks in; they must switch first. */
  CANNOT_HIDE_FOCUSED,
  /** The channel is already hidden. */
  ALREADY_HIDDEN,
  /** The channel is not hidden. */
  NOT_HIDDEN,
  /** A player cannot ignore themselves. */
  CANNOT_IGNORE_SELF,
  /** Staff cannot be ignored, so moderation always reaches players. */
  CANNOT_IGNORE_STAFF,
  /** The player is already ignored. */
  ALREADY_IGNORED,
  /** The player is not ignored. */
  NOT_IGNORED
}
