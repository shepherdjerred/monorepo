package com.shepherdjerred.thestorm.tools.rwfmap;

/**
 * A block state the curated {@link BlockTable} does not know. Never guessed around: the table is
 * extended instead, so every map bakes from a classification someone has looked at.
 */
public final class UnknownBlockStateException extends IllegalArgumentException {

  private static final long serialVersionUID = 1L;

  UnknownBlockStateException(String message) {
    super(message);
  }
}
