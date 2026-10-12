package com.shepherdjerred.thestorm.arena.domain.survival;

import java.util.List;
import java.util.Set;

/** Smooth pressure budgets: special enemies spend a limited share of each encounter. */
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
      Event event,
      int count,
      double health,
      double damage,
      List<String> roster,
      String boss,
      int concurrentLimit,
      int spawnBatch,
      int spawnIntervalSeconds,
      int specialBudget,
      int rangedLimit) {}

  private EncounterDirector() {}

  public static Encounter plan(int round, int players, Set<String> open) {
    if (round < 1 || players < 1 || players > 4)
      throw new IllegalArgumentException("Invalid encounter");
    var extra = players - 1;
    var boss = round % 5 == 0 ? boss(round, open) : "";
    var event = event(round, open);
    var original = originalCount(round, players);
    var count = boss.isEmpty() ? (original * 3 + 1) / 2 : original;
    var specials =
        round < 6
            ? 0
            : Math.max(1, (int) (count * Math.min(.25, .10 + Math.max(0, round - 8) * .01)));
    return new Encounter(
        event,
        count,
        health(round) * .65,
        damage(round) * .60,
        roster(event, round),
        boss,
        boss.isEmpty()
            ? Math.min(48, 9 + 3 * (round - 1) + extra * 2)
            : Math.min(32, cap(round, true) + extra * 2),
        boss.isEmpty() ? 3 : 1,
        boss.isEmpty() ? 1 : round <= 7 ? 2 : 1,
        specials,
        rangedLimit(round, players));
  }

  public static int originalCount(int round, int players) {
    return Math.min(160, count(round, round % 5 == 0) + (players - 1) * 3);
  }

  private static int count(int round, boolean boss) {
    if (boss) return round == 5 ? 4 : Math.min(40, 6 + (round / 5 - 2) * 2);
    return switch (round) {
      case 1 -> 6;
      case 2 -> 8;
      case 3 -> 10;
      case 4 -> 12;
      case 6 -> 16;
      case 7 -> 18;
      default -> (int) Math.min(160, 20L + Math.max(0, round - 8) * 2L);
    };
  }

  private static int cap(int round, boolean boss) {
    if (boss) return round == 5 ? 3 : Math.min(20, 7 + round / 10);
    return switch (round) {
      case 1 -> 3;
      case 2 -> 4;
      case 3 -> 5;
      case 4 -> 6;
      case 6 -> 7;
      case 7 -> 8;
      default -> Math.min(20, 9 + Math.max(0, round - 8) / 2);
    };
  }

  private static double health(int round) {
    return switch (round) {
      case 1 -> .60;
      case 2 -> .75;
      case 3 -> .90;
      case 4, 5 -> 1;
      case 6 -> 1.05;
      case 7 -> 1.10;
      default -> Math.min(8, 1.15 + (round - 8) * .07);
    };
  }

  private static double damage(int round) {
    return switch (round) {
      case 1 -> .50;
      case 2 -> .65;
      case 3 -> .80;
      case 4, 5 -> .85;
      case 6 -> .90;
      case 7 -> .95;
      default -> Math.min(3, 1 + (round - 8) * .02);
    };
  }

  private static int rangedLimit(int round, int players) {
    if (round < 6) return 0;
    if (round <= 7) return players == 1 ? 1 : 2;
    return Math.min(4, 1 + players / 2 + round / 15);
  }

  public static double bossHealth(int round, int players) {
    if (round < 5 || round % 5 != 0 || players < 1 || players > 4)
      throw new IllegalArgumentException("Invalid boss");
    return Math.min(1000, (100 + 20.0 * round) * (100 + (players - 1) * 65) / 100)
        * (round == 5 ? .85 : 1);
  }

  public static boolean ranged(String id) {
    return Set.of("pillager", "bogged", "parched", "blaze", "witch", "skeleton-horseman")
        .contains(id);
  }

  private static Event event(int round, Set<String> open) {
    if (round < 8 || round % 5 == 0) return Event.HORDE;
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
    if (round < 6) return round == 1 ? List.of("zombie") : List.of("zombie", "husk");
    return switch (event) {
      case HORDE ->
          round < 8
              ? List.of("pillager")
              : List.of("spider", "bogged", "arena-slime", "sulfur-cube");
      case ILLAGER_SIEGE -> List.of("pillager", "vindicator", "witch");
      case OMINOUS_TRIAL -> List.of("bogged", "cave-spider", "sulfur-cube");
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
