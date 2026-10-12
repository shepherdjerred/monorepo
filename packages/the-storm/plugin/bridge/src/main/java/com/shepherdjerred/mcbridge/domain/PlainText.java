package com.shepherdjerred.mcbridge.domain;

import java.util.regex.Pattern;

/** Removes terminal and legacy formatting from captured text. */
public final class PlainText {
  private static final Pattern ANSI = Pattern.compile("\u001B\\[[0-9;?]*[ -/]*[@-~]");
  private static final Pattern LEGACY = Pattern.compile("§[0-9a-fk-orx]", Pattern.CASE_INSENSITIVE);

  private PlainText() {}

  /** Strips ANSI escape sequences and legacy section-sign color codes. */
  public static String strip(String text) {
    return LEGACY.matcher(ANSI.matcher(text).replaceAll("")).replaceAll("");
  }
}
