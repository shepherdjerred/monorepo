package com.shepherdjerred.thestorm.essentials.domain.back;

/** Why {@code /back} has nowhere to go. */
public sealed interface BackError {

  /** Nothing is recorded yet. */
  record Empty() implements BackError {}

  /** The player asked to go further back than the history reaches. */
  record NotThatFar(int requested, int available) implements BackError {}
}
