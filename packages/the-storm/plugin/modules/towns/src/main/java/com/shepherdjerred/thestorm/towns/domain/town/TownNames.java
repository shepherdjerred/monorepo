package com.shepherdjerred.thestorm.towns.domain.town;

import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

/** What a town may be called: 3 to 20 letters, digits or underscores. */
public final class TownNames {

  public static final int MIN_LENGTH = 3;
  public static final int MAX_LENGTH = 20;

  /** Prefix of a camp's stored name. Players cannot choose a town name that starts with it. */
  public static final String CAMP_PREFIX = "camp_";

  private static final Pattern NAME =
      Pattern.compile("[A-Za-z0-9_]{" + MIN_LENGTH + "," + MAX_LENGTH + "}");

  private TownNames() {}

  public static boolean isValid(String name) {
    return NAME.matcher(name).matches();
  }

  /** True when {@code name} is a valid town name a player may choose. */
  public static boolean isPublic(String name) {
    return isValid(name) && !name.toLowerCase(Locale.ROOT).startsWith(CAMP_PREFIX);
  }

  /** The stored name of the camp {@code id}. It is valid and not a public town name. */
  public static String campName(UUID id) {
    return CAMP_PREFIX + id.toString().replace("-", "").substring(0, 12);
  }
}
