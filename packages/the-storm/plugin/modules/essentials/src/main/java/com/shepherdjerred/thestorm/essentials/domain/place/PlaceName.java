package com.shepherdjerred.thestorm.essentials.domain.place;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * The name of a home or warp: 1 to 16 lowercase letters, digits, {@code _} or {@code -}. Names are
 * case-insensitive; {@link #parse} lowercases player input.
 *
 * @param value the normalized name
 */
public record PlaceName(String value) implements Comparable<PlaceName> {

  /** The longest allowed name. */
  public static final int MAX_LENGTH = 16;

  private static final Pattern VALID = Pattern.compile("[a-z0-9_-]{1," + MAX_LENGTH + "}");

  public PlaceName {
    if (!VALID.matcher(value).matches()) {
      throw new IllegalArgumentException("invalid place name: " + value);
    }
  }

  /** Validates player input, lowercasing it first. */
  public static Result<PlaceName, String> parse(String input) {
    var normalized = input.strip().toLowerCase(Locale.ROOT);
    if (!VALID.matcher(normalized).matches()) {
      return Result.err(
          "Names are 1-" + MAX_LENGTH + " letters, digits, _ or -; '" + input + "' is not valid");
    }
    return Result.ok(new PlaceName(normalized));
  }

  @Override
  public int compareTo(PlaceName other) {
    return value.compareTo(other.value);
  }

  @Override
  public String toString() {
    return value;
  }
}
