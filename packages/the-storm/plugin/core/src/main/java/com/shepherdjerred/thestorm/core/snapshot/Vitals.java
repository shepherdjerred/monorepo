package com.shepherdjerred.thestorm.core.snapshot;

import java.util.Objects;

/**
 * A player's physical condition, game mode, flight and native damage immunity setting.
 *
 * @param condition health and food state
 * @param gameMode the game mode's name, such as {@code SURVIVAL}
 * @param flight flight permissions, activity and speed
 * @param maximumNoDamageTicks the native damage immunity duration
 * @param formatVersion 1 for historical snapshots without flight/immunity state, 2 for captures
 */
public record Vitals(
    Condition condition,
    String gameMode,
    Flight flight,
    int maximumNoDamageTicks,
    int formatVersion) {

  /** The health and hunger state captured together before entering a game. */
  public record Condition(double health, int food, float saturation, float exhaustion) {
    public Condition {
      if (!(health >= 0)) {
        throw new IllegalArgumentException("health must not be negative: " + health);
      }
      if (food < 0 || food > 20) {
        throw new IllegalArgumentException("food must be 0-20: " + food);
      }
    }
  }

  /** Flight permissions and speed, independent of the player's game mode. */
  public record Flight(boolean allowFlight, boolean flying, float flySpeed) {
    public Flight {
      if (!Float.isFinite(flySpeed) || flySpeed < -1 || flySpeed > 1) {
        throw new IllegalArgumentException("flySpeed must be between -1 and 1: " + flySpeed);
      }
      if (flying && !allowFlight) {
        throw new IllegalArgumentException("flying requires allowFlight");
      }
    }

    private static Flight historical(String gameMode) {
      return new Flight(
          gameMode.equals("CREATIVE") || gameMode.equals("SPECTATOR"),
          gameMode.equals("SPECTATOR"),
          0.1f);
    }
  }

  /** Historical snapshots never captured flight or immunity; use explicit version-one semantics. */
  public Vitals(Condition condition, String gameMode) {
    this(condition, gameMode, Flight.historical(gameMode), 20, 1);
  }

  /** A complete current capture. */
  public Vitals(Condition condition, String gameMode, Flight flight, int maximumNoDamageTicks) {
    this(condition, gameMode, flight, maximumNoDamageTicks, 2);
  }

  public Vitals {
    Objects.requireNonNull(condition, "condition");
    Objects.requireNonNull(flight, "flight");
    if (gameMode.isBlank()) {
      throw new IllegalArgumentException("gameMode must not be blank");
    }
    if (formatVersion != 1 && formatVersion != 2) {
      throw new IllegalArgumentException("unknown vitals format version: " + formatVersion);
    }
    if (maximumNoDamageTicks < 0) {
      throw new IllegalArgumentException("maximumNoDamageTicks must not be negative");
    }
    if (formatVersion == 1
        && (!flight.equals(Flight.historical(gameMode)) || maximumNoDamageTicks != 20)) {
      throw new IllegalArgumentException("version-one vitals require historical semantics");
    }
  }

  public double health() {
    return condition.health();
  }

  public int food() {
    return condition.food();
  }

  public float saturation() {
    return condition.saturation();
  }

  public float exhaustion() {
    return condition.exhaustion();
  }

  public boolean allowFlight() {
    return flight.allowFlight();
  }

  public boolean flying() {
    return flight.flying();
  }

  public float flySpeed() {
    return flight.flySpeed();
  }

  /** Preserve the original digest for rows written before flight/immunity were captured. */
  String fingerprintValue() {
    return formatVersion == 1
        ? "Vitals[health="
            + health()
            + ", food="
            + food()
            + ", saturation="
            + saturation()
            + ", exhaustion="
            + exhaustion()
            + ", gameMode="
            + gameMode
            + "]"
        : toString();
  }
}
