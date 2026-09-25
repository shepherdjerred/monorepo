package com.shepherdjerred.thestorm.spells.domain.config;

import java.util.regex.Pattern;

/** Bounds shared by the config records' compact constructors. Each throws on a bad value. */
final class Checks {

  private static final Pattern NAME = Pattern.compile("[A-Z][A-Z0-9_]*");

  private Checks() {}

  static void between(String field, int value, int min, int max) {
    if (value < min || value > max) {
      throw new IllegalArgumentException(field + " must be " + min + ".." + max + ": " + value);
    }
  }

  static void between(String field, double value, double min, double max) {
    if (!(value >= min && value <= max)) {
      throw new IllegalArgumentException(field + " must be " + min + ".." + max + ": " + value);
    }
  }

  /** A Bukkit enum-style name such as {@code REDSTONE}; the adapter resolves it at enable. */
  static void upperName(String field, String value) {
    if (!NAME.matcher(value).matches()) {
      throw new IllegalArgumentException(field + " must be an upper-case name: " + value);
    }
  }

  static void notBlank(String field, String value) {
    if (value.isBlank()) {
      throw new IllegalArgumentException(field + " must not be blank");
    }
  }
}
