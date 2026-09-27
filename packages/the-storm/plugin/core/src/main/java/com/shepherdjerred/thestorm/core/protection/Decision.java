package com.shepherdjerred.thestorm.core.protection;

import net.kyori.adventure.text.Component;

/** The answer to a protection check. */
public sealed interface Decision {

  /** The action may go ahead. */
  record Allowed() implements Decision {}

  /**
   * The action is refused.
   *
   * @param reason shown to the player, for example "This land belongs to Aegis."
   */
  record Denied(Component reason) implements Decision {}

  static Decision allowed() {
    return new Allowed();
  }

  default boolean isAllowed() {
    return this instanceof Allowed;
  }
}
