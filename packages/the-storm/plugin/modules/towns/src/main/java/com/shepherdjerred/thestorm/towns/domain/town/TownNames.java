package com.shepherdjerred.thestorm.towns.domain.town;

import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Predicate;
import java.util.regex.Pattern;

/** What a town may be called: 3 to 20 letters, digits or underscores. */
public final class TownNames {

  public static final int MIN_LENGTH = 3;
  public static final int MAX_LENGTH = 20;

  /** Prefix of a camp's stored name. Players cannot choose a town name that starts with it. */
  public static final String CAMP_PREFIX = "camp_";

  private static final Pattern NAME =
      Pattern.compile("[A-Za-z0-9_]{" + MIN_LENGTH + "," + MAX_LENGTH + "}");

  /** A camp name minted from a town id before camps took their founder's account name. */
  private static final Pattern GENERATED = Pattern.compile("camp_[0-9a-f]{12}");

  private TownNames() {}

  public static boolean isValid(String name) {
    return NAME.matcher(name).matches();
  }

  /** True when {@code name} is a valid town name a player may choose. */
  public static boolean isPublic(String name) {
    return isValid(name) && !name.toLowerCase(Locale.ROOT).startsWith(CAMP_PREFIX);
  }

  /** The stored name older camps still have: {@code camp_} plus 12 hex digits. */
  public static String campName(UUID id) {
    return CAMP_PREFIX + id.toString().replace("-", "").substring(0, 12);
  }

  /** True when {@code name} is a {@link #campName(UUID)} value and should be renamed. */
  public static boolean isGenerated(String name) {
    return GENERATED.matcher(name).matches();
  }

  /**
   * A camp name taken from {@code accountName}. {@code taken} is asked with each candidate and must
   * ignore case. Empty when the account name has no letters, digits or underscores left.
   */
  public static Optional<String> friendly(String accountName, Predicate<String> taken) {
    var cleaned = accountName.replaceAll("[^A-Za-z0-9_]", "");
    if (cleaned.isEmpty()) {
      return Optional.empty();
    }
    var base = cleaned;
    if (base.length() < MIN_LENGTH) {
      base = base + "_c";
    }
    if (base.length() < MIN_LENGTH) {
      base = base + "amp";
    }
    if (base.length() > MAX_LENGTH) {
      base = base.substring(0, MAX_LENGTH);
    }
    if (free(base, taken)) {
      return Optional.of(base);
    }
    for (var suffix = 2; suffix <= 9999; suffix++) {
      var tail = Integer.toString(suffix);
      var room = MAX_LENGTH - tail.length();
      if (room < 1) {
        return Optional.empty();
      }
      var stem = base.length() <= room ? base : base.substring(0, room);
      var candidate = stem + tail;
      if (candidate.length() >= MIN_LENGTH && free(candidate, taken)) {
        return Optional.of(candidate);
      }
    }
    return Optional.empty();
  }

  private static boolean free(String candidate, Predicate<String> taken) {
    return isValid(candidate) && !isGenerated(candidate) && !taken.test(candidate);
  }
}
