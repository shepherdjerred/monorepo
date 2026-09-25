package com.shepherdjerred.thestorm.mechanics.domain.config;

/**
 * Who benefits from a feature that is not a sign players click: block drops, tools and piston
 * signs.
 *
 * @param enabled whether the feature works at all
 * @param level the Mechanic track level (1 to 5) needed to use it, or to create its sign
 */
public record Unlock(boolean enabled, int level) {

  public Unlock {
    Checks.range("level", level, 1, Checks.MAX_LEVEL);
  }

  /** The same gate, as an {@link Access} whose use needs the creation level. */
  public Access asAccess() {
    return new Access(enabled, level, level);
  }
}
