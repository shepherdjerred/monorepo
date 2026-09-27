package com.shepherdjerred.thestorm.seasonal.domain;

import java.time.MonthDay;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.List;

/** Strict repository-owned seasonal event content. */
public record SeasonalConfig(String mainWorld, String timeZone, List<Event> events) {

  public SeasonalConfig {
    if (mainWorld.isBlank()) {
      throw new IllegalArgumentException("mainWorld must not be blank");
    }
    ZoneId.of(timeZone);
    events = List.copyOf(events);
    if (events.isEmpty()) {
      throw new IllegalArgumentException("at least one seasonal event is required");
    }
    var ids = new HashSet<String>();
    for (var event : events) {
      if (!ids.add(event.id())) {
        throw new IllegalArgumentException("duplicate seasonal event: " + event.id());
      }
    }
  }

  public ZoneId zone() {
    return ZoneId.of(timeZone);
  }

  /** Inclusive annual window, daily visit cap, and weighted outcomes. */
  public record Event(
      String id,
      String title,
      String firstDay,
      String lastDay,
      int spawnRadius,
      int dailyDoors,
      List<Reward> rewards) {

    public Event {
      if (!id.matches("[a-z][a-z0-9_]{0,31}")) {
        throw new IllegalArgumentException("invalid seasonal event id: " + id);
      }
      if (title.isBlank()) {
        throw new IllegalArgumentException("event title must not be blank");
      }
      MonthDay.parse("--" + firstDay);
      MonthDay.parse("--" + lastDay);
      if (spawnRadius < 1 || spawnRadius > 256) {
        throw new IllegalArgumentException("spawnRadius must be 1..256");
      }
      if (dailyDoors < 1 || dailyDoors > 64) {
        throw new IllegalArgumentException("dailyDoors must be 1..64");
      }
      rewards = List.copyOf(rewards);
      if (rewards.isEmpty()) {
        throw new IllegalArgumentException("event rewards must not be empty");
      }
      var weight = 0;
      for (var reward : rewards) {
        weight = Math.addExact(weight, reward.weight());
      }
    }

    public AnnualWindow window() {
      return new AnnualWindow(MonthDay.parse("--" + firstDay), MonthDay.parse("--" + lastDay));
    }
  }

  /** The item and amount granted for a random trick or treat. */
  public record Reward(Kind kind, String material, int amount, int weight) {
    public Reward {
      if (material.isBlank() || amount < 1 || amount > 64 || weight < 1) {
        throw new IllegalArgumentException("invalid seasonal reward");
      }
    }
  }

  public enum Kind {
    TRICK,
    TREAT
  }
}
