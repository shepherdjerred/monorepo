package com.shepherdjerred.thestorm.towns.domain.protection;

/** The engine's answer. */
public sealed interface Verdict {

  /** An allowing verdict. */
  static Verdict allow() {
    return new Allow();
  }

  /** The act may go ahead. */
  record Allow() implements Verdict {}

  /** The act is refused, with the reason. */
  record Deny(Denial denial) implements Verdict {}

  default boolean isAllowed() {
    return this instanceof Allow;
  }

  /** This verdict if it denies, otherwise {@code next}. */
  default Verdict and(Verdict next) {
    return isAllowed() ? next : this;
  }
}
