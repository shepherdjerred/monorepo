package com.shepherdjerred.mcbridge.domain;

import java.util.Locale;

/** The wire {@code type} values of a bridge event. */
public enum EventType {
  CHAT,
  COMMAND,
  JOIN,
  QUIT,
  DEATH,
  LOG,
  BLOCK_BREAK,
  BLOCK_PLACE,
  INTERACT,
  DAMAGE,
  /** Harness actor lifecycle and action outcomes. */
  ACTOR;

  public String wire() {
    return name().toLowerCase(Locale.ROOT);
  }
}
