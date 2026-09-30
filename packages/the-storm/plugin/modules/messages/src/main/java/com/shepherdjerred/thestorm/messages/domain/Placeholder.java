package com.shepherdjerred.thestorm.messages.domain;

import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;

/** A name a death-message template can mention. */
public enum Placeholder {
  /** The player who died. */
  PLAYER,
  /** The mob or player that killed them. */
  KILLER,
  /** What the killing player was holding. */
  WEAPON;

  /** The template token, such as {@code {player}}. */
  public String token() {
    return "{" + name().toLowerCase(Locale.ROOT) + "}";
  }

  /** The placeholder named {@code name}, such as {@code killer}. */
  public static Optional<Placeholder> named(String name) {
    return Arrays.stream(values())
        .filter(placeholder -> placeholder.name().toLowerCase(Locale.ROOT).equals(name))
        .findFirst();
  }
}
