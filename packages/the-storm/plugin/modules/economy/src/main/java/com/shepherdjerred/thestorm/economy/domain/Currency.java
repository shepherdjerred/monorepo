package com.shepherdjerred.thestorm.economy.domain;

/**
 * How one currency is named in chat.
 *
 * @param singular the name of one unit ({@code crystal}, {@code Credit})
 * @param plural the name of any other count ({@code crystals}, {@code Credits})
 * @param symbol the short form after a number ({@code CR}, {@code RC})
 */
public record Currency(String singular, String plural, String symbol) {

  public Currency {
    requireName("singular", singular);
    requireName("plural", plural);
    requireName("symbol", symbol);
  }

  private static void requireName(String property, String value) {
    if (value.isBlank() || !value.strip().equals(value)) {
      throw new IllegalArgumentException(
          property + " must be non-blank without surrounding spaces: '" + value + "'");
    }
  }
}
