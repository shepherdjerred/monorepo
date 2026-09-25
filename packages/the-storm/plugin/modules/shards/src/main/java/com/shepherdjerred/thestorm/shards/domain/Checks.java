package com.shepherdjerred.thestorm.shards.domain;

import java.util.Collection;
import java.util.regex.Pattern;

/** Invariant checks shared by the config records. Each throws {@link IllegalArgumentException}. */
final class Checks {

  private static final Pattern CONSTANT = Pattern.compile("[A-Z][A-Z0-9_]*");
  private static final Pattern KEY = Pattern.compile("[a-z0-9_.-]+:[a-z0-9_./-]+");

  private Checks() {}

  static double probability(String name, double value) {
    if (!(value >= 0 && value <= 1)) {
      throw new IllegalArgumentException(name + " must be between 0 and 1 but was " + value);
    }
    return value;
  }

  static String notBlank(String name, String value) {
    if (value.isBlank()) {
      throw new IllegalArgumentException(name + " must not be blank");
    }
    return value;
  }

  /** A Paper enum constant name, such as {@code DIAMOND_ORE} or {@code ZOMBIE}. */
  static String constant(String name, String value) {
    if (!CONSTANT.matcher(value).matches()) {
      throw new IllegalArgumentException(
          name + " must be an upper-case constant like DIAMOND_ORE but was '" + value + "'");
    }
    return value;
  }

  /** A namespaced key such as {@code minecraft:overworld}. */
  static String key(String name, String value) {
    if (!KEY.matcher(value).matches()) {
      throw new IllegalArgumentException(
          name + " must be a namespaced key like minecraft:overworld but was '" + value + "'");
    }
    return value;
  }

  static void notEmpty(String name, Collection<?> values) {
    if (values.isEmpty()) {
      throw new IllegalArgumentException(name + " must not be empty");
    }
  }

  static void unique(String name, Collection<?> values) {
    if (values.stream().distinct().count() != values.size()) {
      throw new IllegalArgumentException(name + " must not repeat entries: " + values);
    }
  }

  static void perTier(String name, Collection<?> values) {
    if (values.size() != StormTier.MAX_LEVEL) {
      throw new IllegalArgumentException(
          name
              + " needs one entry per tier (I to "
              + new StormTier(StormTier.MAX_LEVEL).numeral()
              + "), "
              + StormTier.MAX_LEVEL
              + " in all, but has "
              + values.size());
    }
  }

  /** Requires every {@code <placeholder>} tag to appear in a MiniMessage template. */
  static String template(String name, String template, String... placeholders) {
    notBlank(name, template);
    for (var placeholder : placeholders) {
      if (!template.contains("<" + placeholder + ">")) {
        throw new IllegalArgumentException(name + " must contain <" + placeholder + ">");
      }
    }
    return template;
  }
}
