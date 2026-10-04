package com.shepherdjerred.mcbridge.domain;

import java.util.Locale;

/** The wire {@code type} values of a bridge event. */
public enum EventType {
  CHAT,
  COMMAND,
  JOIN,
  QUIT,
  DEATH,
  LOG;

  public String wire() {
    return name().toLowerCase(Locale.ROOT);
  }
}
