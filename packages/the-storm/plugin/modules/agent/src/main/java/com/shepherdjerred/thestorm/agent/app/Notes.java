package com.shepherdjerred.thestorm.agent.app;

/** Clips untrusted brain text to storage limits. */
public final class Notes {

  private Notes() {}

  /** The first {@code max} characters of {@code text}. */
  public static String clip(String text, int max) {
    return text.substring(0, Math.min(text.length(), max));
  }
}
