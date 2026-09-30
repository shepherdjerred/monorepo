package com.shepherdjerred.thestorm.messages.domain;

import java.util.Locale;

/** Who, if anyone, killed the player. Names are rendered by the adapter; only the kind matters. */
public sealed interface Killer {

  /** Nobody: the world did it, or the player did it to themselves. */
  record None() implements Killer {}

  /**
   * A mob.
   *
   * @param type the entity type key without its namespace, such as {@code creeper}
   */
  record Mob(String type) implements Killer {
    public Mob {
      requireType(type);
    }

    /** Returns {@code type} if it is a lowercase entity key without a namespace. */
    public static String requireType(String type) {
      if (!type.equals(type.toLowerCase(Locale.ROOT)) || type.isBlank() || type.contains(":")) {
        throw new IllegalArgumentException(
            "mob type must be a lowercase entity key without a namespace: " + type);
      }
      return type;
    }
  }

  /** Another player. */
  record Player() implements Killer {}
}
