package com.shepherdjerred.thestorm.mechanics.domain.stargate;

import java.util.regex.Pattern;

/** Names fit on a sign and are unambiguous in commands and storage. */
public final class Names {
  private static final Pattern VALID = Pattern.compile("[A-Za-z0-9_ -]{1,32}");

  private Names() {}

  public static String require(String value) {
    var name = value.strip();
    if (!VALID.matcher(name).matches()) {
      throw new IllegalArgumentException(
          "gate and network names need 1-32 letters, numbers, spaces, underscores or hyphens");
    }
    return name;
  }
}
