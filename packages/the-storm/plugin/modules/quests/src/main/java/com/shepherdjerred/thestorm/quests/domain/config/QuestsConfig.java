package com.shepherdjerred.thestorm.quests.domain.config;

import com.shepherdjerred.thestorm.quests.domain.engine.Calendar;
import java.time.DateTimeException;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.ZoneId;
import java.util.Locale;

/**
 * {@code quests.yml}. Every value is required; records reject nonsense.
 *
 * @param timezone the IANA time zone days and weeks are counted in, such as {@code
 *     America/Los_Angeles}
 * @param weekStartsOn the first day of a week, such as {@code MONDAY}
 * @param mainWorld the Bukkit name of the only world where quests run
 * @param budget the reward budget the content validator enforces
 * @param party shared credit between nearby players
 * @param board the radiant quest board
 * @param refreshTicks how often held items, track levels, time limits, markers and the sidebar are
 *     re-checked for online players
 * @param spawnedMobSeconds how long creatures a quest spawns live before they are removed
 * @param sidebarLines the most objective lines the tracking sidebar shows
 * @param topSize how many players {@code /quests top} lists
 * @param labels fixed button labels and prompts
 */
public record QuestsConfig(
    String timezone,
    String weekStartsOn,
    String mainWorld,
    Budget budget,
    Party party,
    BoardSettings board,
    int refreshTicks,
    int spawnedMobSeconds,
    int sidebarLines,
    int topSize,
    Labels labels) {

  public QuestsConfig {
    if (mainWorld == null || mainWorld.isBlank()) {
      throw new IllegalArgumentException("mainWorld must name a world");
    }
    try {
      ZoneId.of(timezone);
    } catch (DateTimeException e) {
      throw new IllegalArgumentException("unknown time zone " + timezone, e);
    }
    var _ = DayOfWeek.valueOf(weekStartsOn.toUpperCase(Locale.ROOT));
    if (refreshTicks < 1 || spawnedMobSeconds < 1 || sidebarLines < 1 || sidebarLines > 14) {
      throw new IllegalArgumentException(
          "refreshTicks and spawnedMobSeconds must be positive, sidebarLines 1..14");
    }
    if (topSize < 1 || topSize > 50) {
      throw new IllegalArgumentException("topSize must be 1..50");
    }
  }

  /** Days and weeks as configured. */
  public Calendar calendar() {
    return new Calendar(
        ZoneId.of(timezone), DayOfWeek.valueOf(weekStartsOn.toUpperCase(Locale.ROOT)));
  }

  /**
   * The most crystals a quest may pay: {@code allowance + crystalsPerMinute × estimatedMinutes},
   * summed along the richest path through its stages.
   */
  public record Budget(long crystalsPerMinute, long allowance) {
    public Budget {
      if (crystalsPerMinute < 0 || allowance < 0) {
        throw new IllegalArgumentException("the budget cannot be negative");
      }
    }

    /** The most a quest estimated at {@code minutes} may pay. */
    public long limit(int minutes) {
      return Math.addExact(allowance, Math.multiplyExact(crystalsPerMinute, minutes));
    }
  }

  /**
   * Shared credit.
   *
   * @param radius players this close to a kill or pickup who share the objective also get credit
   * @param activeSeconds a partner must have moved or acted this recently to share credit
   */
  public record Party(double radius, int activeSeconds) {
    public Party {
      if (radius < 0 || radius > 128) {
        throw new IllegalArgumentException("party radius must be 0..128 blocks");
      }
      if (activeSeconds < 1) {
        throw new IllegalArgumentException("activeSeconds must be positive");
      }
    }

    /** How recently a partner must have acted. */
    public Duration active() {
      return Duration.ofSeconds(activeSeconds);
    }
  }

  /**
   * The radiant board.
   *
   * @param npc the NPC that offers board quests and takes their hand-ins
   * @param dailies how many daily quests each player gets
   * @param weeklies how many weekly quests each player gets
   */
  public record BoardSettings(String npc, int dailies, int weeklies) {
    public BoardSettings {
      if (npc.isBlank() || dailies < 0 || dailies > 5 || weeklies < 0 || weeklies > 5) {
        throw new IllegalArgumentException("the board needs an NPC and 0..5 dailies and weeklies");
      }
    }
  }

  /**
   * Fixed dialogue labels (content supplies the rest).
   *
   * @param accept the accept button
   * @param decline the decline button
   * @param handIn the hand-in button
   * @param back the button back to the previous screen
   * @param goodbye the button that closes a dialogue
   * @param menu the prompt when an NPC has several quests for the player
   */
  public record Labels(
      String accept, String decline, String handIn, String back, String goodbye, String menu) {
    public Labels {
      for (var label : new String[] {accept, decline, handIn, back, goodbye}) {
        if (label.isBlank() || label.length() > 32) {
          throw new IllegalArgumentException("labels must be 1..32 characters: " + label);
        }
      }
      if (menu.isBlank() || menu.length() > 200) {
        throw new IllegalArgumentException("the menu prompt must be 1..200 characters");
      }
    }
  }
}
