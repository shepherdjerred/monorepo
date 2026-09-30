package com.shepherdjerred.thestorm.arena.domain.kit;

import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * Every class, from {@code arena/classes.yml}, keyed by id (such as {@code wolfmaster}).
 *
 * @param classes class id to class
 */
public record ClassBook(Map<String, ArenaClass> classes) {

  private static final Pattern ID = Pattern.compile("[a-z][a-z0-9-]*");

  /** The permission prefix for advanced classes; the class id follows. */
  public static final String PERMISSION_PREFIX = "thestorm.arena.class.";

  public ClassBook {
    if (classes.isEmpty()) {
      throw new IllegalArgumentException("at least one class is required");
    }
    for (var id : classes.keySet()) {
      if (!ID.matcher(id).matches()) {
        throw new IllegalArgumentException("class id must be lower-case kebab-case: " + id);
      }
    }
    if (classes.values().stream().allMatch(ArenaClass::advanced)) {
      throw new IllegalArgumentException("at least one class must be open to everyone");
    }
    classes = Map.copyOf(new TreeMap<>(classes));
  }

  public Optional<ArenaClass> find(String id) {
    return Optional.ofNullable(classes.get(id));
  }

  public ArenaClass require(String id) {
    return find(id).orElseThrow(() -> new IllegalArgumentException("unknown class " + id));
  }

  /** The permission that unlocks advanced class {@code id}. */
  public static String permission(String id) {
    return PERMISSION_PREFIX + id;
  }
}
