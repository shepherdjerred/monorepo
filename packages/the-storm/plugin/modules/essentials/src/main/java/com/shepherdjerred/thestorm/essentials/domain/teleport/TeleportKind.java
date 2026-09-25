package com.shepherdjerred.thestorm.essentials.domain.teleport;

import java.util.Locale;

/** The kinds of paid teleport. Each has its own base cost, cooldown and usage multiplier. */
public enum TeleportKind {
  SPAWN,
  HOME,
  TPA,
  BACK,
  WARP;

  /** The lowercase id used in storage and ledger reasons, for example {@code home}. */
  public String id() {
    return name().toLowerCase(Locale.ROOT);
  }

  /** The kind with {@code id}, as stored by {@link #id()}. */
  public static TeleportKind fromId(String id) {
    for (var kind : values()) {
      if (kind.id().equals(id)) {
        return kind;
      }
    }
    throw new IllegalArgumentException("unknown teleport kind: " + id);
  }
}
