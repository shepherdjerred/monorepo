package com.shepherdjerred.thestorm.creative.domain;

import java.util.Locale;

/** Which visit a stored body belongs to. */
public enum BodyRole {
  /** Belongings left outside creative. Restored exactly on leave. */
  SURVIVAL,
  /** In-session creative belongings, kept only to resume a crash. */
  CREATIVE;

  /** The value stored in SQLite. */
  public String wire() {
    return name().toLowerCase(Locale.ROOT);
  }

  /** The role stored as {@code wire}, or an exception when the row is corrupt. */
  public static BodyRole parse(String wire) {
    for (var role : values()) {
      if (role.wire().equals(wire)) {
        return role;
      }
    }
    throw new IllegalArgumentException("unknown creative body role: " + wire);
  }
}
