package com.shepherdjerred.thestorm.quests.domain.config;

import com.shepherdjerred.thestorm.quests.domain.engine.Calendar;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import java.time.DateTimeException;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.ZoneId;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.regex.Pattern;

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
 * @param refreshTicks how often held items, track levels, time limits, the board, markers and the
 *     tracker are re-checked for online players
 * @param spawnedMobSeconds how long creatures a quest spawns live before they are removed
 * @param placedBlockDays how long a block a player placed is remembered, so breaking it does not
 *     count for mine objectives
 * @param permissionConditions the only permission nodes content may test with {@code permission}
 *     conditions; they are registered as off by default
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
    int placedBlockDays,
    List<String> permissionConditions,
    int sidebarLines,
    int topSize,
    Labels labels) {

  /** Permission nodes: lowercase words joined by dots. */
  public static final Pattern NODE = Pattern.compile("[a-z0-9_-]+(\\.[a-z0-9_-]+)+");

  public QuestsConfig {
    if (mainWorld == null || mainWorld.isBlank()) {
      throw new IllegalArgumentException("mainWorld must name a world");
    }
    permissionConditions = List.copyOf(permissionConditions);
    try {
      ZoneId.of(timezone);
    } catch (DateTimeException e) {
      throw new IllegalArgumentException("unknown time zone " + timezone, e);
    }
    var _ = DayOfWeek.valueOf(weekStartsOn.toUpperCase(Locale.ROOT));
    if (refreshTicks < 1 || spawnedMobSeconds < 1 || placedBlockDays < 1) {
      throw new IllegalArgumentException(
          "refreshTicks, spawnedMobSeconds and placedBlockDays must be positive");
    }
    if (sidebarLines < 1 || sidebarLines > 14) {
      throw new IllegalArgumentException("sidebarLines must be 1..14");
    }
    if (topSize < 1 || topSize > 50) {
      throw new IllegalArgumentException("topSize must be 1..50");
    }
    for (var node : permissionConditions) {
      if (!NODE.matcher(node).matches()) {
        throw new IllegalArgumentException("not a permission node: " + node);
      }
    }
  }

  /** Days and weeks as configured. */
  public Calendar calendar() {
    return new Calendar(
        ZoneId.of(timezone), DayOfWeek.valueOf(weekStartsOn.toUpperCase(Locale.ROOT)));
  }

  /** How long placed blocks are remembered. */
  public Duration placedBlockMemory() {
    return Duration.ofDays(placedBlockDays);
  }

  /**
   * The reward budget.
   *
   * @param crystalsPerMinute crystals a quest may pay per estimated minute
   * @param allowance crystals every quest may pay on top
   * @param dailyRepeatableCap the most all repeatable quests together may pay one player in a day
   *     (daily quests and daily board quests, plus a seventh of weekly ones)
   * @param deliveryMargin how far above the NPC shop price a repeatable delivery may pay, as a
   *     fraction (0.1 is 10%), so buying items to hand in never profits much
   * @param itemValues crystals one of each material is worth: what an NPC shop charges for it, or a
   *     set value for items shops do not sell. Items a quest gives must be listed
   */
  public record Budget(
      long crystalsPerMinute,
      long allowance,
      long dailyRepeatableCap,
      double deliveryMargin,
      Map<String, Double> itemValues) {

    public Budget {
      itemValues = Map.copyOf(new TreeMap<>(itemValues));
      if (crystalsPerMinute < 0 || allowance < 0 || dailyRepeatableCap < 0 || deliveryMargin < 0) {
        throw new IllegalArgumentException("the budget cannot be negative");
      }
      for (var entry : itemValues.entrySet()) {
        if (!ItemMatch.MATERIAL.matcher(entry.getKey()).matches() || entry.getValue() <= 0) {
          throw new IllegalArgumentException(
              "item values are MATERIAL: positive crystals: " + entry.getKey());
        }
      }
    }

    /** The most a quest estimated at {@code minutes} may pay. */
    public long limit(int minutes) {
      return Math.addExact(allowance, Math.multiplyExact(crystalsPerMinute, minutes));
    }

    /** What one of {@code material} is worth, if it has a value. */
    public Optional<Double> value(String material) {
      return Optional.ofNullable(itemValues.get(material));
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
      if (radius < 0 || radius > 16) {
        throw new IllegalArgumentException("party radius must be 0..16 blocks");
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
