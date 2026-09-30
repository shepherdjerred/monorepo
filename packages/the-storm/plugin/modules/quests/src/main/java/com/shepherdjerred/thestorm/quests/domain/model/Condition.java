package com.shepherdjerred.thestorm.quests.domain.model;

/**
 * Something that is true or false for a player right now: quest requirements and branch guards.
 * World conditions (items, tracks, time, weather, region, permission) are answered by the server;
 * state conditions (quests, reputation, variables, points) by the player's quest state.
 */
public sealed interface Condition {

  /** Has at least {@code amount} matching items. */
  record HasItem(ItemMatch item, int amount) implements Condition {}

  /** Is at least {@code level} in {@code track}. */
  record TrackAtLeast(String track, int level) implements Condition {}

  /** Has completed {@code quest} at least once. */
  record Completed(String quest) implements Condition {}

  /** Has {@code quest} active. */
  record Active(String quest) implements Condition {}

  /** Has at least {@code amount} reputation with {@code faction}. */
  record ReputationAtLeast(String faction, long amount) implements Condition {}

  /** Has at least {@code amount} quest points. */
  record PointsAtLeast(long amount) implements Condition {}

  /**
   * The in-game time is in {@code [from, to)}, in minutes after midnight (06:00 is sunrise). The
   * range may wrap past midnight.
   */
  record TimeBetween(int from, int to) implements Condition {
    public TimeBetween {
      if (from < 0 || from >= MINUTES_PER_DAY || to < 0 || to >= MINUTES_PER_DAY || from == to) {
        throw new IllegalArgumentException("a time range needs two different times of day");
      }
    }
  }

  /** The weather in the player's world is {@code weather}. */
  record WeatherIs(Weather weather) implements Condition {}

  /** Is inside {@code region}. */
  record InRegion(String region) implements Condition {}

  /** Has permission {@code node}. */
  record HasPermission(String node) implements Condition {}

  /** Variable {@code name} (0 if never set) compares to {@code value}. */
  record Compare(String variable, Comparison comparison, long value) implements Condition {}

  /** {@code condition} is false. */
  record Not(Condition condition) implements Condition {}

  /** Minutes in a day. */
  int MINUTES_PER_DAY = 24 * 60;

  /** The weather. {@code THUNDER} is the storm. */
  enum Weather {
    CLEAR,
    RAIN,
    THUNDER
  }

  /** How a variable compares to a value. */
  enum Comparison {
    EQUAL("=="),
    NOT_EQUAL("!="),
    LESS("<"),
    LESS_OR_EQUAL("<="),
    GREATER(">"),
    GREATER_OR_EQUAL(">=");

    private final String symbol;

    Comparison(String symbol) {
      this.symbol = symbol;
    }

    public String symbol() {
      return symbol;
    }

    public boolean test(long left, long right) {
      return switch (this) {
        case EQUAL -> left == right;
        case NOT_EQUAL -> left != right;
        case LESS -> left < right;
        case LESS_OR_EQUAL -> left <= right;
        case GREATER -> left > right;
        case GREATER_OR_EQUAL -> left >= right;
      };
    }
  }
}
