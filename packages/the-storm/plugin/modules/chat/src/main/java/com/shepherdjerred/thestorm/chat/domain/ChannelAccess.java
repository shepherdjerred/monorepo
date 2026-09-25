package com.shepherdjerred.thestorm.chat.domain;

/** Whether a player may talk in a channel right now. */
public enum ChannelAccess {
  /** They may. */
  GRANTED,
  /** The channel needs a permission they lack (staff chat). */
  NO_PERMISSION,
  /** No module provides the channel's members yet (towns are not live). */
  UNAVAILABLE,
  /** They are not in a town or nation. */
  NOT_A_MEMBER
}
