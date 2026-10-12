package com.shepherdjerred.thestorm.rwfbots.domain.world;

/** The things a bot can choose to be doing. */
public enum Option {
  ENGAGE,
  RETREAT,
  HEAL,
  ARM,
  HELP_ARM,
  DEFUSE,
  /** Go to the playbook slot, bounding from cover to cover once enemies are known. */
  TAKE_SLOT,
  /** Stand at the playbook slot watching its threat, in cover once enemies are known. */
  HOLD_SLOT,
  HOLD_ANGLE,
  RETAKE,
  HUNT,
  ESCAPE_POISON,
  REWIND
}
