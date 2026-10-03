package com.shepherdjerred.thestorm.arena.domain.survival;

import java.util.List;
import java.util.Set;

/** Endless encounters with bounded concurrent entities and authored unlock requirements. */
public final class EncounterDirector {
  public enum Event {
    HORDE,
    ILLAGER_SIEGE,
    OMINOUS_TRIAL,
    MOUNTED_ASSAULT,
    PALE_INCURSION,
    NETHER_BREACH
  }

  public record Encounter(
      Event event, int count, double health, double damage, List<String> roster, String boss) {}

  private EncounterDirector() {}

  public static Encounter plan(int round, int players, Set<String> open) {
    if (round < 1 || players < 1 || players > 4) {
      throw new IllegalArgumentException("Invalid encounter");
    }
    var event = event(round, open);
    var count = (int) Math.min(160, 8L + round * 3L + (players - 1) * 5L);
    var health = Math.min(8, 1 + (round - 1) * 0.08);
    var damage = Math.min(3, 1 + (round - 1) * 0.025);
    return new Encounter(
        event,
        count,
        health,
        damage,
        roster(event, round),
        round % 5 == 0 ? boss(round, open) : "");
  }

  private static Event event(int round, Set<String> open) {
    if (round % 5 == 0 || round < 3) {
      return Event.HORDE;
    }
    return switch (round % 6) {
      case 0 -> open.contains("barracks") ? Event.ILLAGER_SIEGE : Event.HORDE;
      case 1 -> Event.OMINOUS_TRIAL;
      case 2 -> open.contains("ramparts") ? Event.MOUNTED_ASSAULT : Event.HORDE;
      case 3 -> open.contains("crypt") ? Event.PALE_INCURSION : Event.HORDE;
      case 4 -> open.contains("foundry") ? Event.NETHER_BREACH : Event.HORDE;
      default -> Event.HORDE;
    };
  }

  private static List<String> roster(Event event, int round) {
    return switch (event) {
      case HORDE ->
          round < 3
              ? List.of("zombie", "husk", "spider")
              : List.of("zombie", "husk", "spider", "bogged", "parched", "sulfur-cube");
      case ILLAGER_SIEGE -> List.of("pillager", "vindicator", "witch");
      case OMINOUS_TRIAL -> List.of("bogged", "cave-spider", "sulfur-cube", "gale-sovereign");
      case MOUNTED_ASSAULT -> List.of("camel-husk-jockey", "zombie-horseman", "skeleton-horseman");
      case PALE_INCURSION -> List.of("vex", "wither-skeleton", "bogged");
      case NETHER_BREACH -> List.of("blaze", "brute-guard", "magma-cube", "wither-skeleton");
    };
  }

  private static String boss(int round, Set<String> open) {
    return switch ((round / 5 - 1) % 5) {
      case 0 -> "gale-sovereign";
      case 1 -> open.contains("barracks") ? "hexmaster" : "gale-sovereign";
      case 2 -> "ravager";
      case 3 -> open.contains("crypt") ? "heartwood" : "hexmaster";
      default -> open.contains("crypt") ? "warden" : "ravager";
    };
  }
}
