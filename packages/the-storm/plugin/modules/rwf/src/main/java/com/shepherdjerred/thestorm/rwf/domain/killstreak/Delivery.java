// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/killstreak/StreakBase.java,
// streaks/SupplyCrateKillstreak.java, streaks/NapalmKillstreak.java,
// streaks/CompassKillstreak.java, streaks/WolvesKillstreak.java and
// streaks/IronGolemKillstreak.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.killstreak;

import java.time.Duration;
import java.util.random.RandomGenerator;

/**
 * Red Warfare's numbers for delivering and playing out killstreak rewards. The rules that need the
 * world (where the highest block is, what is solid) stay with the adapter; the arithmetic is here.
 */
public final class Delivery {

  /** A dropped reward falls from at least this far above the highest block. */
  public static final int LEAST_FALL = 50;

  /** A landing reward booms at this volume and pitch (a pitch the client caps at 2). */
  public static final float LANDING_VOLUME = 1;

  public static final float LANDING_PITCH = 7;

  /** A landing reward settles at most this many blocks up or down onto clear ground. */
  public static final int SETTLE_STEPS = 10;

  /** And from about this high above the block it was used on. */
  public static final int TARGET_FALL = 100;

  /** Two supply crates stand at least this far apart (taxicab, across the ground). */
  public static final int CRATE_SPACING = 1;

  /** The owner's teammates may loot a crate this long after it lands. */
  public static final Duration TEAM_LOOTS_AFTER = Duration.ofSeconds(30);

  /** Anyone may loot a crate this long after it lands. */
  public static final Duration ANYONE_LOOTS_AFTER = Duration.ofSeconds(60);

  /** Napalm sets alight everyone of the other teams within this many blocks. */
  public static final double NAPALM_REACH = 20;

  /** Napalm's explosion, in vanilla explosion power. */
  public static final float NAPALM_POWER = 9;

  /** The most napalm's explosion deals, Red Warfare's default explosion cap. */
  public static final double NAPALM_MAX_DAMAGE = 1000;

  /** Falling napalm is driven down at this speed, blocks a tick, and hisses every few ticks. */
  public static final double NAPALM_FALL_SPEED = -0.6;

  public static final int NAPALM_HISS_EVERY = 5;

  /** Napalm's fireballs burn this long, rekindled this often, until they slow below this. */
  public static final int FIREBALL_FIRE_TICKS = 19;

  public static final int FIREBALL_REKINDLE_EVERY = 10;

  public static final double FIREBALL_STOPPED = 0.05;

  /** A fireball can never be picked up: Red Warfare's pickup delay. */
  public static final int FIREBALL_PICKUP_DELAY = 999_999;

  /** Each fireball is thrown out this fast: its ring offset over this, and this up. */
  public static final double FIREBALL_SPREAD = 1.5;

  public static final double FIREBALL_LIFT = 0.5;

  /** The fireball ring: offsets from -1 to 1 in steps of this, inside this squared radius. */
  public static final float FIREBALL_STEP = 0.25F;

  public static final float FIREBALL_RING = 0.75F;

  /** Everyone within this many blocks of the thrower hears that napalm was released. */
  public static final double NAPALM_WARNING = 40;

  /** How many attack dogs arrive. */
  public static final int WOLVES = 3;

  /** An attack dog's health. */
  public static final double WOLF_HEALTH = 14;

  /** What an attack dog's bite deals, before armor. */
  public static final double WOLF_BITE = 6;

  /** How far an attack dog looks for prey. */
  public static final double WOLF_RANGE = 14;

  /** Attack dogs spawn up to this far off the landing, on each horizontal axis. */
  public static final double WOLF_SPREAD = 0.4;

  /**
   * An attack dog heels to a spot this far ahead of its owner, and is called back when it strays
   * further than {@link #WOLF_HEEL} from it, or {@link #WOLF_LEASH} while it hunts.
   */
  public static final double WOLF_AHEAD = 3;

  public static final double WOLF_HEEL = 1.5;

  public static final double WOLF_LEASH = 16;

  /** A dog runs back at this speed, or this when its owner sprints. */
  public static final double WOLF_SPEED = 1;

  public static final double WOLF_SPRINT_SPEED = 1.4;

  /** An iron golem's most health, and the health it lands with. */
  public static final double GOLEM_MAX_HEALTH = 40;

  public static final double GOLEM_HEALTH = 20;

  /** An iron golem throws whoever it hits straight up this fast. */
  public static final double GOLEM_THROW = 1;

  /** A tracked enemy is told at most this often that a compass found them. */
  public static final Duration COMPASS_WARNING = Duration.ofSeconds(30);

  /** The tracked enemy hears an experience orb at this volume and pitch. */
  public static final float COMPASS_VOLUME = 4;

  public static final float COMPASS_PITCH = 0;

  /** The tracker is told the distance at most this often. */
  public static final Duration COMPASS_MESSAGE = Duration.ofSeconds(2);

  /** How far the compass may stray from a hidden kit, on each axis. */
  public static final double COMPASS_STRAY = 8;

  /** The compass's stray and the crates' labels change every half second, in ticks. */
  public static final int HALF_SECOND_TICKS = 10;

  /** Attack dogs look for prey and come back to heel every second, in ticks. */
  public static final int SECOND_TICKS = 20;

  private Delivery() {}

  /**
   * The height a reward used on a block at {@code usedY} falls from, with {@code highestY} the
   * first air above that column (what the server of Red Warfare's day called its highest block):
   * about {@link #TARGET_FALL} above the block, never less than {@link #LEAST_FALL} above the
   * highest one.
   */
  public static int dropHeight(int highestY, int usedY) {
    return highestY + Math.max(TARGET_FALL - (highestY - usedY), LEAST_FALL);
  }

  /** Whether two crate columns stand too close: within {@link #CRATE_SPACING}, taxicab. */
  public static boolean crowded(int x1, int z1, int x2, int z2) {
    return Math.abs(x1 - x2) + Math.abs(z1 - z2) <= CRATE_SPACING;
  }

  /**
   * Whether a crate that landed {@code since} ago may be looted by someone: its owner always, the
   * owner's team after {@link #TEAM_LOOTS_AFTER}, and anyone after {@link #ANYONE_LOOTS_AFTER}.
   */
  public static boolean mayLoot(boolean owner, boolean teammate, Duration since) {
    if (owner || since.compareTo(ANYONE_LOOTS_AFTER) >= 0) {
      return true;
    }
    return teammate && since.compareTo(TEAM_LOOTS_AFTER) >= 0;
  }

  /**
   * What a crate holds: one to three steaks, one to three ender pearls unless the endgame has
   * begun, and half the time an unbreakable diamond chestplate for a looter without one.
   *
   * @param random the match's randomness
   * @param endgame whether the endgame has begun
   * @param hasChestplate whether the looter already carries a diamond chestplate
   */
  public static Loot loot(RandomGenerator random, boolean endgame, boolean hasChestplate) {
    var steak = random.nextInt(3) + 1;
    var pearls = endgame ? 0 : random.nextInt(3) + 1;
    var chestplate = random.nextBoolean() && !hasChestplate;
    return new Loot(steak, pearls, chestplate);
  }

  /**
   * A crate's contents.
   *
   * @param steak cooked beef
   * @param pearls ender pearls
   * @param chestplate whether an unbreakable diamond chestplate
   */
  public record Loot(int steak, int pearls, boolean chestplate) {}

  /**
   * The ticks of fire napalm gives someone {@code distance} blocks from where it landed: a quarter
   * second less per block, none past {@link #NAPALM_REACH}.
   */
  public static int fireTicks(double distance) {
    return ((int) (NAPALM_REACH - Math.ceil(distance))) * 5;
  }

  /**
   * The fire {@code ticks} come to on someone whose armour carries {@code levels} of Fire
   * Protection in all, as Red Warfare's {@code ConditionManager.setFire} reckoned it: none of it
   * changes nothing, and any of it leaves {@code min(80, 15 × levels)} per cent, rounded up. So a
   * little protection shortens the burn a lot, and more protection shortens it less.
   */
  public static int fireProtected(int ticks, int levels) {
    if (levels <= 0) {
      return ticks;
    }
    return (int) Math.ceil(ticks * (Math.min(80, levels * 15) / 100D));
  }

  /**
   * The way a supply crate faces, for Red Warfare's roll of {@code roll} (0 to 3) written as the
   * chest's block data: values 0 and 1 meant up and down, which a chest cannot face and read as
   * north, 2 was north and 3 south. So three crates in four face north.
   */
  public static String crateFacing(int roll) {
    return switch (roll) {
      case 0, 1, 2 -> "NORTH";
      case 3 -> "SOUTH";
      default -> throw new IllegalArgumentException("a crate's roll is 0 to 3: " + roll);
    };
  }

  /** What a crate's label reads for viewers who may loot {@code wait} after it landed. */
  public static String crateStatus(Duration wait, Duration since) {
    if (since.compareTo(wait) >= 0) {
      return "Lootable";
    }
    return "Lootable in " + (long) Math.ceil(wait.minus(since).toMillis() / 1000.0);
  }

  /** What an iron golem's blow deals, before armor: 13 or 14. */
  public static double golemBlow(RandomGenerator random) {
    return 13 + random.nextInt(2);
  }

  /**
   * The compass's stray on one axis after half a second more. Red Warfare stepped it by {@code
   * UtilMath.r(-1, 1)}, a whole number from -1 up to but not including 1: so each step is -1 or 0,
   * and the stray sinks to -8 and stays near it.
   */
  public static double stray(double current, RandomGenerator random) {
    return Math.clamp(current + (random.nextInt(2) - 1), -COMPASS_STRAY, COMPASS_STRAY);
  }
}
