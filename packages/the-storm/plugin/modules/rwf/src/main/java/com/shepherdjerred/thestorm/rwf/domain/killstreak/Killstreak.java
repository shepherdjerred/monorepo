// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/killstreak/
// KillstreakManager.java, StreakBase.java and streaks/*.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.killstreak;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Red Warfare's killstreak rewards, in the order its manager handed them out. Each is earned at a
 * whole step of a combatant's killstreak (one per kill plus each assist's share): the compass at
 * exactly two, the others at every multiple of their count. All but the compass are delivered from
 * the sky: the item is used on a block, and its reward lands there from far above.
 */
public enum Killstreak {
  /** A compass that points at the nearest enemy. */
  COMPASS("a tracking compass", 2, true, "COMPASS", Optional.empty()),
  /** A chest of food, ender pearls and perhaps a diamond chestplate. */
  SUPPLY_CRATE("supply crate", 4, false, "REDSTONE", Optional.of("OAK_PLANKS")),
  /** Three attack dogs that fight for the team. */
  WOLVES("attack dogs", 4, false, "WOLF_SPAWN_EGG", Optional.of("WHITE_WOOL")),
  /** An iron golem that fights for the team. */
  IRON_GOLEM("iron golem", 8, false, "IRON_GOLEM_SPAWN_EGG", Optional.of("IRON_BLOCK")),
  /** A firebomb that sets the area alight. */
  NAPALM("Napalm", 11, false, "TNT", Optional.of("TNT"));

  private final String title;
  private final int kills;
  private final boolean exact;
  private final String item;
  private final Optional<String> falling;

  Killstreak(String title, int kills, boolean exact, String item, Optional<String> falling) {
    this.title = title;
    this.kills = kills;
    this.exact = exact;
    this.item = item;
    this.falling = falling;
  }

  /**
   * How Red Warfare's item for a reward looked. Its {@code ItemBuilder} turned a title with no
   * colour of its own grey, and wrapped lore at 50 characters ({@code LineFormat.LORE}), so the
   * lore is kept here as it was shown, one line per entry.
   *
   * @param name its name
   * @param color the name's colour, as Adventure names it
   * @param bold whether the name is bold
   * @param lore the lore lines, in order
   * @param loreColor the lore's colour
   */
  public record Look(String name, String color, boolean bold, List<String> lore, String loreColor) {

    public Look {
      lore = List.copyOf(lore);
    }
  }

  /** How the reward's item looks. */
  public Look look() {
    return switch (this) {
      case COMPASS -> new Look("Tracking Compass", "green", true, List.of(), "green");
      case SUPPLY_CRATE ->
          new Look(
              "Supply Crate",
              "red",
              false,
              List.of("Use this in a clear", "area to receive supplies!"),
              "gray");
      case WOLVES -> new Look("Summon attack dogs", "gray", false, List.of(), "gray");
      case IRON_GOLEM -> new Look("Summon Iron Golem", "gray", false, List.of(), "gray");
      case NAPALM ->
          new Look(
              "Napalm", "dark_red", false, List.of("Use to drop napalm in", "the area!"), "red");
    };
  }

  /** How Red Warfare named the reward: "Given a tracking compass!". */
  public String title() {
    return title;
  }

  /** The kills it takes. */
  public int kills() {
    return kills;
  }

  /** The item that carries the reward, as {@code TNT}. */
  public String item() {
    return item;
  }

  /** The block that falls to deliver the reward; none for the compass, which is held. */
  public Optional<String> falling() {
    return falling;
  }

  /** Whether the reward is dropped from the sky by using its item on a block. */
  public boolean dropped() {
    return falling.isPresent();
  }

  /** Whether a killstreak of {@code streak} whole steps earns this. */
  public boolean earnedAt(int streak) {
    if (streak <= 0) {
      return false;
    }
    return exact ? streak == kills : streak % kills == 0;
  }

  /**
   * What a killstreak climbing from {@code before} to {@code after} whole steps earns, step by step
   * and in Red Warfare's order within a step.
   */
  public static List<Earned> earned(int before, int after) {
    var earned = new ArrayList<Earned>();
    for (var step = before + 1; step <= after; step++) {
      for (var streak : values()) {
        if (streak.earnedAt(step)) {
          earned.add(new Earned(streak, step));
        }
      }
    }
    return List.copyOf(earned);
  }

  /**
   * The reward whose item is {@code material}, if any. Red Warfare matched a held item to its
   * reward by material alone, so any compass tracks and any TNT is napalm.
   */
  public static Optional<Killstreak> byItem(String material) {
    for (var streak : values()) {
      if (streak.item().equals(material)) {
        return Optional.of(streak);
      }
    }
    return Optional.empty();
  }

  /**
   * A reward and the killstreak that earned it.
   *
   * @param streak the reward
   * @param kills the whole killstreak steps reached
   */
  public record Earned(Killstreak streak, int kills) {}
}
