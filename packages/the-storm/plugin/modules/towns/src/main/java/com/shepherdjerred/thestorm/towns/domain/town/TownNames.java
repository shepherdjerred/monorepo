package com.shepherdjerred.thestorm.towns.domain.town;

import java.util.regex.Pattern;

/** What a town may be called: 3 to 20 letters, digits or underscores. */
public final class TownNames {

  public static final int MIN_LENGTH = 3;
  public static final int MAX_LENGTH = 20;

  private static final Pattern NAME =
      Pattern.compile("[A-Za-z0-9_]{" + MIN_LENGTH + "," + MAX_LENGTH + "}");

  private TownNames() {}

  public static boolean isValid(String name) {
    return NAME.matcher(name).matches();
  }
}
