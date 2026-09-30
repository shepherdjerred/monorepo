package com.shepherdjerred.thestorm.seasonal.domain;

import java.time.LocalDate;
import java.util.HashSet;
import java.util.Set;

/** A player's door visits for one event and local calendar day. */
public record DailyDoors(LocalDate day, Set<String> visited) {

  public DailyDoors {
    visited = Set.copyOf(visited);
  }

  public static DailyDoors parse(String serialized, LocalDate today) {
    var parts = serialized.split("\\|", -1);
    if (parts.length != 2) {
      throw new IllegalArgumentException("invalid seasonal claim state");
    }
    if (!LocalDate.parse(parts[0]).equals(today)) {
      return new DailyDoors(today, Set.of());
    }
    if (parts[1].isEmpty()) {
      return new DailyDoors(today, Set.of());
    }
    var keys = Set.of(parts[1].split(";", -1));
    for (var key : keys) {
      if (!key.matches("-?[0-9]+,-?[0-9]+,-?[0-9]+")) {
        throw new IllegalArgumentException("invalid seasonal door coordinate: " + key);
      }
    }
    return new DailyDoors(today, keys);
  }

  public Claim claim(String door, int maximum) {
    if (visited.contains(door)) {
      return new Claim(this, Status.ALREADY_VISITED);
    }
    if (visited.size() >= maximum) {
      return new Claim(this, Status.DAILY_LIMIT);
    }
    var next = new HashSet<>(visited);
    next.add(door);
    return new Claim(new DailyDoors(day, next), Status.GRANTED);
  }

  public String serialize() {
    return day + "|" + String.join(";", visited.stream().sorted().toList());
  }

  public enum Status {
    GRANTED,
    ALREADY_VISITED,
    DAILY_LIMIT
  }

  public record Claim(DailyDoors state, Status status) {}
}
