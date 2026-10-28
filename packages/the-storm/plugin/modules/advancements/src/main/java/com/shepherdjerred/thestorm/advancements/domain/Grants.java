package com.shepherdjerred.thestorm.advancements.domain;

import java.util.ArrayList;
import java.util.List;

/**
 * Which advancements a fact earns. Pure: callers pass counts and ids, and this returns advancement
 * paths. Reaching a step earns every earlier step in that chain. An empty list earns nothing.
 */
public final class Grants {

  private static final int[] QUEST_COUNTS = {1, 10, 25, 50, 100};
  private static final int[] CLAIM_COUNTS = {1, 25, 50, 100, 200};
  private static final int[] SKILL_LEVELS = {100, 250, 500, 1000};
  private static final int[] WAVE_COUNTS = {1, 10, 25, 40, 60};
  private static final int[] MATCH_COUNTS = {1, 25, 100};
  private static final int[] WIN_COUNTS = {1, 10, 25, 50};
  private static final int[] KILL_COUNTS = {1, 25, 100, 250};
  private static final int[] ASSIST_COUNTS = {10, 50};
  private static final int[] WIN_STREAKS = {3, 5};

  private Grants() {}

  public static List<String> home() {
    return List.of("a_survival/home");
  }

  public static List<String> lock() {
    return List.of("a_survival/lock");
  }

  /** Distinct saved story, side, and track quests. */
  public static List<String> quests(int count) {
    return steps("a_survival/quest", count, QUEST_COUNTS);
  }

  /** {@code member} founded or joined a town that now has {@code claims} chunks. */
  public static List<String> town(boolean member, int claims) {
    if (!member) {
      return List.of();
    }
    requireNonNegative(claims, "town claims");
    var earned = new ArrayList<String>();
    earned.add("a_survival/town/settled");
    for (var step : CLAIM_COUNTS) {
      if (claims >= step) {
        earned.add("a_survival/town/" + step);
      }
    }
    return List.copyOf(earned);
  }

  /** The highest Storm tier carried. Zero has never been upgraded. */
  public static List<String> shard(int tier) {
    if (tier < 0 || tier > 5) {
      throw new IllegalArgumentException("storm tier must be 0..5: " + tier);
    }
    var earned = new ArrayList<String>();
    for (var level = 1; level <= tier; level++) {
      earned.add("a_survival/shard/" + level);
    }
    return List.copyOf(earned);
  }

  /** {@code track} is the track id, such as {@code mechanic}. */
  public static List<String> track(String track, int level) {
    if (level < 0 || level > 5) {
      throw new IllegalArgumentException("track level must be 0..5: " + level);
    }
    var earned = new ArrayList<String>();
    for (var step = 1; step <= level; step++) {
      earned.add("b_tracks/" + track + "/" + step);
    }
    return List.copyOf(earned);
  }

  /** Every skill threshold {@code level} has already passed. */
  public static List<String> skill(String skill, int level) {
    return steps("c_skills/" + skill, level, SKILL_LEVELS);
  }

  /** Thresholds crossed by a level-up from {@code from} exclusive to {@code to} inclusive. */
  public static List<String> skillCrossed(String skill, int from, int to) {
    if (from < 0 || to <= from) {
      throw new IllegalArgumentException("a level up rises: " + from + " -> " + to);
    }
    var earned = new ArrayList<String>();
    for (var step : SKILL_LEVELS) {
      if (from < step && step <= to) {
        earned.add("c_skills/" + skill + "/" + step);
      }
    }
    return List.copyOf(earned);
  }

  public static List<String> waves(int best) {
    return steps("e_arena/wave", best, WAVE_COUNTS);
  }

  public static List<String> cleared() {
    return List.of("e_arena/clear");
  }

  /**
   * What an arena announcement earns. A defeat earns nothing. Victory is the final-wave clear, not
   * a wave threshold.
   */
  public static List<String> arenaNotice(String kind, int wave) {
    return switch (kind) {
      case "WAVE_CLEARED" -> waves(wave);
      case "VICTORY" -> cleared();
      case "DEFEAT" -> List.of();
      default -> List.of();
    };
  }

  public static List<String> firstSpell() {
    return List.of("d_spells/first");
  }

  public static List<String> spell(String spell) {
    if (spell.isBlank() || spell.indexOf('/') >= 0) {
      throw new IllegalArgumentException("spell id: " + spell);
    }
    return List.of("d_spells/" + spell);
  }

  /**
   * Lifetime Search and Destroy totals. {@code wins} already excludes a live AFK win.
   *
   * @param matches matches played
   * @param wins wins that count
   * @param kills kills
   * @param assists assists
   * @param bestWinStreak the longest run of wins
   * @param bestStreak the most killstreak rewards earned in one match
   */
  public record SearchTotals(
      int matches, int wins, int kills, int assists, int bestWinStreak, int bestStreak) {}

  /** Lifetime Search and Destroy totals. {@code wins} already excludes a live AFK win. */
  public static List<String> search(SearchTotals totals) {
    var earned = new ArrayList<String>();
    earned.addAll(steps("f_search/matches", totals.matches(), MATCH_COUNTS));
    if (totals.wins() > 0 && !earned.contains("f_search/matches/1")) {
      throw new IllegalArgumentException("a win requires a match");
    }
    for (var step : WIN_COUNTS) {
      if (totals.wins() >= step) {
        earned.add("f_search/wins/" + step);
      }
    }
    earned.addAll(steps("f_search/kills", totals.kills(), KILL_COUNTS));
    earned.addAll(steps("f_search/assists", totals.assists(), ASSIST_COUNTS));
    earned.addAll(steps("f_search/winstreak", totals.bestWinStreak(), WIN_STREAKS));
    if (totals.bestStreak() >= 1) {
      earned.add("f_search/killstreak");
    } else if (totals.bestStreak() < 0) {
      throw new IllegalArgumentException("killstreak cannot be negative");
    }
    return List.copyOf(earned);
  }

  /**
   * Wins to award after a stored match. The lifetime row already counts an AFK win; that win is
   * removed for the live grant. A later join reads the stored total as it is.
   */
  public static int winsCountingThisMatch(int storedWins, boolean won, boolean afk) {
    requireNonNegative(storedWins, "wins");
    if (won && afk) {
      if (storedWins == 0) {
        throw new IllegalArgumentException("an AFK win was not stored");
      }
      return storedWins - 1;
    }
    return storedWins;
  }

  private static List<String> steps(String directory, int value, int[] thresholds) {
    requireNonNegative(value, directory);
    var earned = new ArrayList<String>();
    for (var step : thresholds) {
      if (value >= step) {
        earned.add(directory + "/" + step);
      }
    }
    return List.copyOf(earned);
  }

  private static void requireNonNegative(int value, String name) {
    if (value < 0) {
      throw new IllegalArgumentException(name + " cannot be negative: " + value);
    }
  }
}
