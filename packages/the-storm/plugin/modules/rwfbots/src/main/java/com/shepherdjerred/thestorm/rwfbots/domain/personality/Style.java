package com.shepherdjerred.thestorm.rwfbots.domain.personality;

/**
 * How a personality likes to play, each 0..1.
 *
 * @param aggression taking fights over avoiding them
 * @param patience holding angles over pushing
 * @param teamplay sticking with and helping teammates
 * @param risk gambling on plants and flanks
 */
public record Style(double aggression, double patience, double teamplay, double risk) {

  public Style {
    check("aggression", aggression);
    check("patience", patience);
    check("teamplay", teamplay);
    check("risk", risk);
  }

  private static void check(String name, double value) {
    if (!(value >= 0 && value <= 1)) {
      throw new IllegalArgumentException("style " + name + " must be 0..1: " + value);
    }
  }
}
