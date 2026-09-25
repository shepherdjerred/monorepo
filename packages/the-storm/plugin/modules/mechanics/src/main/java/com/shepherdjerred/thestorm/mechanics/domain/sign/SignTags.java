package com.shepherdjerred.thestorm.mechanics.domain.sign;

import static java.util.stream.Collectors.toUnmodifiableMap;

import java.util.Arrays;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Reads the tag line of a sign. Matching ignores case and whitespace, so {@code [lift up]}, {@code
 * [LIFT UP]} and {@code [LiftUp]} all name {@link Mechanism#LIFT_UP}; creation rewrites the line to
 * the canonical {@link Mechanism#tag()}.
 */
public final class SignTags {

  /** The tag goes on the second line, as on CraftBook signs. */
  public static final int TAG_LINE = 1;

  private static final Pattern WHITESPACE = Pattern.compile("\\s+");

  /** Other spellings accepted on creation, for players used to CraftBook. */
  private static final Map<String, Mechanism> ALIASES = Map.of("[I]", Mechanism.LIGHT_SWITCH);

  private static final Map<String, Mechanism> BY_KEY =
      Stream.concat(
              Arrays.stream(Mechanism.values())
                  .map(mechanism -> Map.entry(mechanism.tag(), mechanism)),
              ALIASES.entrySet().stream())
          .collect(toUnmodifiableMap(entry -> normalize(entry.getKey()), Map.Entry::getValue));

  private SignTags() {}

  /** The mechanism a tag line names, if any. */
  public static Optional<Mechanism> parse(String line) {
    return Optional.ofNullable(BY_KEY.get(normalize(line)));
  }

  /** Lowercase with all whitespace removed. */
  static String normalize(String line) {
    return WHITESPACE.matcher(line).replaceAll("").toLowerCase(Locale.ROOT);
  }
}
