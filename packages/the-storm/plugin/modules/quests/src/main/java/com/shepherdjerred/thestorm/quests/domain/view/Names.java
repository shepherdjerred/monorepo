package com.shepherdjerred.thestorm.quests.domain.view;

import static java.util.stream.Collectors.joining;

import java.util.Arrays;
import java.util.Locale;

/** Readable names for material and entity ids. */
public final class Names {

  private Names() {}

  /** {@code IRON_INGOT} becomes {@code Iron Ingot}. */
  public static String pretty(String id) {
    return Arrays.stream(id.toLowerCase(Locale.ROOT).split("_", -1))
        .filter(word -> !word.isEmpty())
        .map(word -> Character.toUpperCase(word.charAt(0)) + word.substring(1))
        .collect(joining(" "));
  }
}
