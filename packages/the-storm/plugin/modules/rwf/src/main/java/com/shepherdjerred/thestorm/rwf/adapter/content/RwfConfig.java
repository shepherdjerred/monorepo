package com.shepherdjerred.thestorm.rwf.adapter.content;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.shepherdjerred.thestorm.rwf.domain.bomb.Bomb;
import com.shepherdjerred.thestorm.rwf.domain.combat.CombatRules;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSettings;
import com.shepherdjerred.thestorm.rwf.domain.poison.PoisonClock;
import com.shepherdjerred.thestorm.rwf.domain.reward.Payout;
import java.time.Duration;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * {@code rwf.yml}: the two worlds the lobby and the matches run in, where players stand outside a
 * match, how matches fill and start, the ported rule constants (pinned, so the file documents them
 * and the module refuses a file that disagrees with the code), rewards, recording, the load test
 * switch and the maps kept out of the rotation.
 *
 * @param worlds the owned lobby and previously provisioned map world; the module seals both
 * @param spectator where players stand when no match places them elsewhere
 * @param match how matches fill and start
 * @param rules the ported Red Warfare constants this build plays by
 * @param rewards credit payouts
 * @param recording match recordings
 * @param loadtest whether {@code /rwf admin loadtest} is available
 * @param quarantine map id to why it is kept out of the rotation; quarantined maps still ship and
 *     are verified, but no match is played on them
 */
public record RwfConfig(
    Worlds worlds,
    PointEntry spectator,
    Match match,
    Rules rules,
    Rewards rewards,
    Recording recording,
    LoadTest loadtest,
    com.shepherdjerred.thestorm.rwf.app.ExperienceSettings experience,
    Map<String, String> quarantine) {

  private static final Pattern WORLD = Pattern.compile("[A-Za-z0-9_.-]+");
  private static final Pattern MAP_ID = Pattern.compile("[a-z0-9]+(?:-[a-z0-9]+)*");

  public RwfConfig {
    java.util.Objects.requireNonNull(experience, "experience is required");
    for (var entry : quarantine.entrySet()) {
      if (!MAP_ID.matcher(entry.getKey()).matches()) {
        throw new IllegalArgumentException("quarantine names no map id: " + entry.getKey());
      }
      if (entry.getValue().isBlank()) {
        throw new IllegalArgumentException("quarantine of " + entry.getKey() + " needs a reason");
      }
    }
    quarantine = Collections.unmodifiableMap(new TreeMap<>(quarantine));
    new com.shepherdjerred.thestorm.rwf.domain.kit.KitPool(experience.kits());
  }

  /**
   * The two sealed worlds: the lobby players wait in, and the maps matches are fought on.
   *
   * @param lobby the lobby world
   * @param maps the map world
   * @param lobbyProvisioning the explicit startup ownership of the lobby world
   */
  public record Worlds(String lobby, String maps, LobbyProvisioning lobbyProvisioning) {

    public Worlds {
      for (var world : List.of(lobby, maps)) {
        if (!WORLD.matcher(world).matches()) {
          throw new IllegalArgumentException("worlds must be plain world names: " + world);
        }
      }
      if (lobby.equals(maps)) {
        throw new IllegalArgumentException("the lobby and the maps stand in different worlds");
      }
      if (!lobby.matches("[a-z0-9][a-z0-9_.-]{0,63}")
          || List.of("world", "world_nether", "world_the_end", "overworld", "the_nether", "the_end")
              .contains(lobby)) {
        throw new IllegalArgumentException(
            "the owned lobby needs a dedicated safe lowercase world name");
      }
      if (lobbyProvisioning == null) {
        throw new IllegalArgumentException("lobbyProvisioning is required");
      }
    }
  }

  /** The lobby is created as void terrain and subsequently loaded without resetting it. */
  public enum LobbyProvisioning {
    @JsonProperty("owned-void")
    OWNED_VOID
  }

  /**
   * The domain settings for these rules, with the full match flow: a match starts with {@code
   * minHumans} members. The runner turns the vote, preview, freeze and carry-over off as the flags
   * decide.
   */
  public MatchSettings matchSettings() {
    return new MatchSettings(
        match.minPlayers(),
        match.absoluteMinPlayers(),
        match.maxCombatants(),
        match.countdown(),
        match.relaxEvery(),
        match.endLinger(),
        rewards.minMatchLength(),
        match.voteLead(),
        match.previewLength(),
        match.freezeLength(),
        true,
        new com.shepherdjerred.thestorm.rwf.domain.kit.KitPool(experience.kits()));
  }

  /**
   * How matches fill and start.
   *
   * @param minHumans the fewest humans a match starts with, and keeps counting down with
   * @param minPlayers players (humans and bots) a lobby wants before it counts down, as Red
   *     Warfare's LobbyManager had it
   * @param absoluteMinPlayers the fewest players the requirement relaxes to
   * @param relaxEvery how long a waiting lobby takes to want one player fewer
   * @param targetCombatants how many combatants bots fill the match up to
   * @param automaticSizing whether ordinary matches use the map's large preset
   * @param maxCombatants the most combatants in a match
   * @param countdown from enough humans to going live
   * @param endLinger how long the result is shown before the map resets
   * @param noHumansAbort how long a live match runs with no humans before it is stopped unpaid
   * @param voteLead how long before the countdown ends the map vote closes, so the chosen map loads
   *     meanwhile
   * @param previewLength how long members fly over the chosen map before the teams are dealt
   * @param freezeLength how long everyone stands still at their spawn before the fight
   */
  public record Match(
      int minHumans,
      int minPlayers,
      int absoluteMinPlayers,
      Duration relaxEvery,
      int targetCombatants,
      boolean automaticSizing,
      int maxCombatants,
      Duration countdown,
      Duration endLinger,
      Duration noHumansAbort,
      Duration voteLead,
      Duration previewLength,
      Duration freezeLength) {

    public Match {
      if (minHumans < 1 || targetCombatants < minHumans || maxCombatants < targetCombatants) {
        throw new IllegalArgumentException(
            "need 1 <= minHumans <= targetCombatants <= maxCombatants");
      }
      if (absoluteMinPlayers < 1
          || minPlayers < absoluteMinPlayers
          || maxCombatants < minPlayers
          || !positive(relaxEvery)) {
        throw new IllegalArgumentException(
            "need 1 <= absoluteMinPlayers <= minPlayers <= maxCombatants and relaxEvery > 0");
      }
      if (!positive(countdown) || !positive(noHumansAbort) || endLinger.isNegative()) {
        throw new IllegalArgumentException("countdown and noHumansAbort must be positive");
      }
      if (voteLead.isNegative() || voteLead.compareTo(countdown) > 0) {
        throw new IllegalArgumentException("voteLead must be between zero and the countdown");
      }
      if (!positive(previewLength) || !positive(freezeLength)) {
        throw new IllegalArgumentException("previewLength and freezeLength must be positive");
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
   * Red Warfare credit payouts, paid in the economy's {@code rwf_credits}.
   *
   * @param win {@link Payout#WIN}, pinned
   * @param lose {@link Payout#LOSE}, pinned
   * @param afkPenalty {@link Payout#AFK_PENALTY}, pinned: taken from a player AFK for the whole
   *     match instead of any pay
   * @param botFloor {@link Payout#FLOOR}, pinned: the share paid when every other combatant is a
   *     bot
   * @param minMatchLength matches shorter than this pay, and charge, nobody
   */
  public record Rewards(
      int win, int lose, int afkPenalty, double botFloor, Duration minMatchLength) {

    public Rewards {
      pin("win", win == Payout.WIN, Payout.WIN);
      pin("lose", lose == Payout.LOSE, Payout.LOSE);
      pin("afkPenalty", afkPenalty == Payout.AFK_PENALTY, Payout.AFK_PENALTY);
      pin("botFloor", botFloor == Payout.FLOOR, Payout.FLOOR);
      if (minMatchLength.isNegative()) {
        throw new IllegalArgumentException("minMatchLength must not be negative");
      }
    }
  }

  /**
   * Match recordings.
   *
   * @param enabled whether matches are recorded at all
   * @param directory the folder under the plugin data folder recordings are written to
   * @param retentionDays archived recordings older than this are deleted at enable; a recording
   *     that is not archived is never deleted
   * @param maxBytes the oldest archived recordings are deleted at enable until the folder fits this
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
