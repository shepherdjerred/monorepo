package com.shepherdjerred.thestorm.rwf.adapter.content;

import com.shepherdjerred.thestorm.rwf.domain.bomb.Bomb;
import com.shepherdjerred.thestorm.rwf.domain.combat.CombatRules;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSettings;
import com.shepherdjerred.thestorm.rwf.domain.poison.PoisonClock;
import com.shepherdjerred.thestorm.rwf.domain.reward.Payout;
import java.time.Duration;
import java.time.ZoneId;
import java.time.zone.ZoneRulesException;
import java.util.regex.Pattern;

/**
 * {@code rwf.yml}: the world matches run in, where players wait, how matches fill and start, the
 * ported rule constants (pinned, so the file documents them and the module refuses a file that
 * disagrees with the code), rewards, recording and the load test switch.
 *
 * @param world the loaded world matches run in; the module seals it
 * @param lobby where players wait before a match
 * @param spectator where players stand when no match places them elsewhere
 * @param match how matches fill and start
 * @param rules the ported Red Warfare constants this build plays by
 * @param rewards credit payouts
 * @param recording match recordings
 * @param loadtest whether {@code /rwf admin loadtest} is available
 */
public record RwfConfig(
    String world,
    PointEntry lobby,
    PointEntry spectator,
    Match match,
    Rules rules,
    Rewards rewards,
    Recording recording,
    LoadTest loadtest) {

  private static final Pattern WORLD = Pattern.compile("[A-Za-z0-9_.-]+");

  public RwfConfig {
    if (!WORLD.matcher(world).matches()) {
      throw new IllegalArgumentException("world must be a plain world name: " + world);
    }
  }

  /** The domain settings for these rules: a match starts with {@code minHumans} members. */
  public MatchSettings matchSettings() {
    return new MatchSettings(
        match.minHumans(),
        match.minHumans(),
        match.maxCombatants(),
        match.countdown(),
        match.countdown(),
        match.endLinger(),
        rewards.minMatchLength());
  }

  /**
   * How matches fill and start.
   *
   * @param minHumans the fewest humans a match starts with, and keeps counting down with
   * @param targetCombatants how many combatants bots fill the match up to
   * @param maxCombatants the most combatants in a match
   * @param countdown from enough humans to going live
   * @param endLinger how long the result is shown before the map resets
   * @param noHumansAbort how long a live match runs with no humans before it is stopped unpaid
   */
  public record Match(
      int minHumans,
      int targetCombatants,
      int maxCombatants,
      Duration countdown,
      Duration endLinger,
      Duration noHumansAbort) {

    public Match {
      if (minHumans < 1 || targetCombatants < minHumans || maxCombatants < targetCombatants) {
        throw new IllegalArgumentException(
            "need 1 <= minHumans <= targetCombatants <= maxCombatants");
      }
      if (!positive(countdown) || !positive(noHumansAbort) || endLinger.isNegative()) {
        throw new IllegalArgumentException("countdown and noHumansAbort must be positive");
      }
    }
  }

  /**
   * The ported constants, pinned: each must equal the value in the domain.
   *
   * @param fuseSeconds {@link Bomb#FUSE_SECONDS}
   * @param craterRadius {@link Bomb#CRATER_RADIUS}
   * @param poisonTimer {@link PoisonClock#INITIAL}
   * @param poisonGrace {@link PoisonClock#GRACE}
   * @param attackSpeedModifier {@link CombatRules#ATTACK_SPEED_MODIFIER}
   * @param steakHealth {@link CombatRules#STEAK_HEALTH}
   * @param hunger {@link CombatRules#HUNGER}
   */
  public record Rules(
      int fuseSeconds,
      int craterRadius,
      Duration poisonTimer,
      Duration poisonGrace,
      double attackSpeedModifier,
      double steakHealth,
      boolean hunger) {

    public Rules {
      pin("fuseSeconds", fuseSeconds == Bomb.FUSE_SECONDS, Bomb.FUSE_SECONDS);
      pin("craterRadius", craterRadius == Bomb.CRATER_RADIUS, Bomb.CRATER_RADIUS);
      pin("poisonTimer", poisonTimer.equals(PoisonClock.INITIAL), PoisonClock.INITIAL);
      pin("poisonGrace", poisonGrace.equals(PoisonClock.GRACE), PoisonClock.GRACE);
      pin(
          "attackSpeedModifier",
          attackSpeedModifier == CombatRules.ATTACK_SPEED_MODIFIER,
          CombatRules.ATTACK_SPEED_MODIFIER);
      pin("steakHealth", steakHealth == CombatRules.STEAK_HEALTH, CombatRules.STEAK_HEALTH);
      pin("hunger", hunger == CombatRules.HUNGER, CombatRules.HUNGER);
    }
  }

  /**
   * Credit payouts.
   *
   * @param win {@link Payout#WIN}, pinned
   * @param lose {@link Payout#LOSE}, pinned
   * @param botFloor {@link Payout#FLOOR}, pinned: the share paid when every other combatant is a
   *     bot
   * @param dailyCap the most credits one player earns from matches in a day
   * @param minMatchLength matches shorter than this pay nobody
   * @param timeZone the zone whose midnight starts a new day
   */
  public record Rewards(
      int win, int lose, double botFloor, long dailyCap, Duration minMatchLength, String timeZone) {

    public Rewards {
      pin("win", win == Payout.WIN, Payout.WIN);
      pin("lose", lose == Payout.LOSE, Payout.LOSE);
      pin("botFloor", botFloor == Payout.FLOOR, Payout.FLOOR);
      if (dailyCap < 1) {
        throw new IllegalArgumentException("dailyCap must be positive: " + dailyCap);
      }
      if (minMatchLength.isNegative()) {
        throw new IllegalArgumentException("minMatchLength must not be negative");
      }
      zone(timeZone);
    }

    public ZoneId zone() {
      return zone(timeZone);
    }

    private static ZoneId zone(String id) {
      try {
        return ZoneId.of(id);
      } catch (ZoneRulesException e) {
        throw new IllegalArgumentException("unknown time zone: " + id, e);
      }
    }
  }

  /**
   * Match recordings.
   *
   * @param enabled whether matches are recorded at all
   * @param directory the folder under the plugin data folder recordings are written to
   * @param retentionDays recordings older than this are deleted at enable
   * @param maxBytes the oldest recordings are deleted at enable until the folder fits this
   * @param saltEnv the environment variable holding the pseudonym salt; required when enabled
   */
  public record Recording(
      boolean enabled, String directory, int retentionDays, long maxBytes, String saltEnv) {

    private static final Pattern DIRECTORY = Pattern.compile("[A-Za-z0-9_-]+");
    private static final Pattern ENV = Pattern.compile("[A-Z][A-Z0-9_]*");

    public Recording {
      if (!DIRECTORY.matcher(directory).matches()) {
        throw new IllegalArgumentException("directory must be one plain folder name: " + directory);
      }
      if (retentionDays < 1 || maxBytes < 1) {
        throw new IllegalArgumentException("retentionDays and maxBytes must be positive");
      }
      if (!ENV.matcher(saltEnv).matches()) {
        throw new IllegalArgumentException("saltEnv must be an environment variable name");
      }
    }
  }

  /**
   * The load test switch.
   *
   * @param enabled whether {@code /rwf admin loadtest <n>} may fill the lobby with bots
   */
  public record LoadTest(boolean enabled) {}

  private static boolean positive(Duration duration) {
    return !duration.isNegative() && !duration.isZero();
  }

  private static void pin(String key, boolean matches, Object expected) {
    if (!matches) {
      throw new IllegalArgumentException(
          key + " is pinned to the ported rules and must be " + expected);
    }
  }
}
