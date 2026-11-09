package com.shepherdjerred.thestorm.mechanics.domain.ic;

import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

/** CraftBook's original IC suffix is outside the closing bracket: {@code [MC1111]S}. */
public record CircuitTag(Kind kind, boolean selfTriggered) {
  private static final Pattern TAG =
      Pattern.compile("\\[(MC[0-9]{4})](S)?", Pattern.CASE_INSENSITIVE);

  public enum Kind {
    INVERTER,
    AND,
    TRANSMITTER,
    RECEIVER,
    CLOCK,
    CRAFTER,
    BREAKER,
    FERTILIZER,
    SORTER,
    PLANTER,
    CULTIVATOR,
    HARVESTER,
    ANIMAL_HARVESTER,
    BREEDER,
    FIREWORK_SHOW;

    public boolean farming() {
      return switch (this) {
        case INVERTER, AND, TRANSMITTER, RECEIVER, CLOCK -> false;
        case CRAFTER,
            BREAKER,
            FERTILIZER,
            SORTER,
            PLANTER,
            CULTIVATOR,
            HARVESTER,
            ANIMAL_HARVESTER,
            BREEDER,
            FIREWORK_SHOW ->
            true;
      };
    }
  }

  public static Optional<CircuitTag> parse(String text) {
    var match = TAG.matcher(text.strip());
    if (!match.matches()) return Optional.empty();
    var kind =
        switch (match.group(1).toUpperCase(Locale.ROOT)) {
          case "MC1001" -> Optional.of(Kind.INVERTER);
          case "MC3002" -> Optional.of(Kind.AND);
          case "MC1110" -> Optional.of(Kind.TRANSMITTER);
          case "MC1111" -> Optional.of(Kind.RECEIVER);
          case "MC1421" -> Optional.of(Kind.CLOCK);
          case "MC1219" -> Optional.of(Kind.CRAFTER);
          case "MC1220" -> Optional.of(Kind.BREAKER);
          case "MC1223" -> Optional.of(Kind.FERTILIZER);
          case "MC1229" -> Optional.of(Kind.SORTER);
          case "MC1234" -> Optional.of(Kind.PLANTER);
          case "MC1235" -> Optional.of(Kind.CULTIVATOR);
          case "MC1239" -> Optional.of(Kind.HARVESTER);
          case "MC1244" -> Optional.of(Kind.ANIMAL_HARVESTER);
          case "MC1280" -> Optional.of(Kind.BREEDER);
          case "MC1253" -> Optional.of(Kind.FIREWORK_SHOW);
          default -> Optional.<Kind>empty();
        };
    return kind.map(found ->
        new CircuitTag(
            found,
            found == Kind.CLOCK
                || found == Kind.FIREWORK_SHOW
                || (found != Kind.INVERTER
                    && found != Kind.AND
                    && found != Kind.TRANSMITTER
                    && found != Kind.FIREWORK_SHOW
                    && match.group(2) != null)));
  }
}
