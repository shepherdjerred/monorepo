package com.shepherdjerred.thestorm.rwfbots.domain.difficulty;

import java.util.Locale;

/** The ten knobs that make a bot stronger or weaker, each with its legal range. */
public enum Lever {
  /** How long after something happens the bot reacts to it. Lower is better. */
  REACTION_MS(150, 450, true, 0.85),
  /** The standing deviation of the aim error. Lower is better. */
  AIM_ERROR_DEG(0.5, 6, true, 1.3),
  /** How fast the view can turn. */
  TURN_RATE_DEG_PER_TICK(8, 45, false, 1.0),
  /** Clicks per second when meleeing. */
  CPS(5, 12, false, 1.0),
  /** How well target motion is predicted, 0 none to 1 perfect. */
  PREDICTION_QUALITY(0, 1, false, 1.0),
  /** Softmax temperature when choosing options. Lower is sharper. */
  DECISION_TEMPERATURE(0.05, 1, true, 1.0),
  /** How far away enemies can be noticed, in blocks. */
  AWARENESS_RADIUS(24, 64, false, 1.0),
  /** How promptly and reliably sightings reach teammates, 0..1. */
  COORDINATION(0, 1, false, 1.0),
  /** W-taps, strafing and clean fuse work, 0..1. */
  TECHNIQUE(0, 1, false, 1.2),
  /** Willingness to take fights, 0..1. */
  AGGRESSION(0, 1, false, 1.0);

  private final double min;
  private final double max;
  private final boolean lowerIsBetter;
  private final double curveExponent;

  Lever(double min, double max, boolean lowerIsBetter, double curveExponent) {
    this.min = min;
    this.max = max;
    this.lowerIsBetter = lowerIsBetter;
    this.curveExponent = curveExponent;
  }

  public double min() {
    return min;
  }

  public double max() {
    return max;
  }

  public double range() {
    return max - min;
  }

  /** Whether a smaller value makes the bot stronger. */
  public boolean lowerIsBetter() {
    return lowerIsBetter;
  }

  /** The exponent shaping how this lever responds to skill; values above one back-load it. */
  public double curveExponent() {
    return curveExponent;
  }

  /** The value at the weak end of the range. */
  public double worst() {
    return lowerIsBetter ? max : min;
  }

  /** The value at the strong end of the range. */
  public double best() {
    return lowerIsBetter ? min : max;
  }

  /** The configuration key of this lever: lower camel case, such as {@code reactionMs}. */
  public String key() {
    var lower = name().toLowerCase(Locale.ROOT);
    var builder = new StringBuilder(lower.length());
    var upperNext = false;
    for (var i = 0; i < lower.length(); i++) {
      var c = lower.charAt(i);
      if (c == '_') {
        upperNext = true;
      } else {
        builder.append(upperNext ? Character.toUpperCase(c) : c);
        upperNext = false;
      }
    }
    return builder.toString();
  }

  /** The lever with configuration key {@code key}; an unknown key is an error. */
  public static Lever byKey(String key) {
    for (var lever : values()) {
      if (lever.key().equals(key)) {
        return lever;
      }
    }
    throw new IllegalArgumentException("unknown lever: " + key);
  }

  /** {@code value} if it is inside this lever's range, otherwise an error. */
  public double check(double value) {
    if (!(value >= min && value <= max)) {
      throw new IllegalArgumentException(key() + " must be " + min + ".." + max + ": " + value);
    }
    return value;
  }

  public double clamp(double value) {
    return Math.clamp(value, min, max);
  }
}
