package com.shepherdjerred.thestorm.rwfbots.adapter.content;

import com.shepherdjerred.thestorm.rwfbots.app.Governor;
import com.shepherdjerred.thestorm.rwfbots.app.ThinkRates;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.ChatSettings;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Lever;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Voice;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.time.Duration;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * {@code rwfbots.yml}: the think rates, the governor thresholds, the lever curves (pinned to the
 * code so the file documents them and the module refuses a file that disagrees), the kits bots may
 * draft, the line-of-sight ray budget, trace recording and bot chat.
 *
 * @param think how often each think layer runs
 * @param governor when the governor steps in
 * @param levers the lever curve table, pinned
 * @param draft which kits bots may be given
 * @param awareness the ray budget per think job
 * @param traces decision trace recording
 * @param chat what bots say in the match world
 */
public record RwfBotsConfig(
    Think think,
    GovernorSettings governor,
    Map<String, LeverCurve> levers,
    Draft draft,
    Awareness awareness,
    Traces traces,
    Chat chat) {

  public RwfBotsConfig {
    levers = Map.copyOf(levers);
    for (var lever : Lever.values()) {
      var curve = levers.get(lever.key());
      if (curve == null) {
        throw new IllegalArgumentException("levers is missing " + lever.key());
      }
      curve.pin(lever);
    }
    for (var key : levers.keySet()) {
      Lever.byKey(key);
    }
    // Builds the chat settings once so a bad chat section fails at load.
    var _ = chat.toSettings();
  }

  /**
   * Think rates, in ticks.
   *
   * @param perceptionEveryTicks ticks between perception passes per bot
   * @param tacticsEveryTicks ticks between think steps per bot
   * @param teamEveryTicks ticks between team steps per team
   * @param maxDecisionAgeTicks a decision from a snapshot older than this is stale
   */
  public record Think(
      int perceptionEveryTicks,
      int tacticsEveryTicks,
      int teamEveryTicks,
      int maxDecisionAgeTicks) {}

  /**
   * The governor thresholds; see {@link Governor}.
   *
   * @param level1Mspt the p95 tick time that enters level 1, milliseconds
   * @param level2Mspt the p95 tick time that enters level 2, milliseconds
   * @param botSectionMs the bot section time that enters level 1, milliseconds
   * @param recoverMspt the p95 tick time below which a level is left, milliseconds
   * @param recoverBotMs the bot section time below which a level is left, milliseconds
   * @param sustainSamples how many ticks in a row a condition must hold
   * @param isolationRadius bots with no human this close reflex every other tick at level 1
   * @param level2DraftReduction how many fewer bots the next match drafts at level 2
   */
  public record GovernorSettings(
      double level1Mspt,
      double level2Mspt,
      double botSectionMs,
      double recoverMspt,
      double recoverBotMs,
      int sustainSamples,
      double isolationRadius,
      int level2DraftReduction) {

    public Governor.Settings toSettings() {
      return new Governor.Settings(
          level1Mspt,
          level2Mspt,
          botSectionMs,
          recoverMspt,
          recoverBotMs,
          sustainSamples,
          isolationRadius,
          level2DraftReduction);
    }
  }

  /**
   * One lever's curve, pinned to {@link Lever}.
   *
   * @param min the weak end of the range for lower-is-better levers, else the strong end
   * @param max the other end
   * @param exponent how the lever responds to skill
   * @param lowerIsBetter whether a smaller value is stronger
   */
  public record LeverCurve(double min, double max, double exponent, boolean lowerIsBetter) {

    void pin(Lever lever) {
      if (min != lever.min()
          || max != lever.max()
          || exponent != lever.curveExponent()
          || lowerIsBetter != lever.lowerIsBetter()) {
        throw new IllegalArgumentException(
            lever.key()
                + " is pinned to the code: min "
                + lever.min()
                + ", max "
                + lever.max()
                + ", exponent "
                + lever.curveExponent()
                + ", lowerIsBetter "
                + lever.lowerIsBetter());
      }
    }
  }

  /**
   * What the director may hand out.
   *
   * @param kits the kit ids rwf ships that bots may be given, lower-case
   */
  public record Draft(List<String> kits) {

    private static final Pattern KIT = Pattern.compile("[a-z][a-z0-9-]*");

    public Draft {
      kits = List.copyOf(kits);
      if (kits.isEmpty()) {
        throw new IllegalArgumentException("draft.kits must name at least one kit");
      }
      for (var kit : kits) {
        if (!KIT.matcher(kit).matches()) {
          throw new IllegalArgumentException("kit ids are lower-case: " + kit);
        }
        Kit.valueOf(kit.toUpperCase(Locale.ROOT));
      }
    }

    public Set<Kit> availableKits() {
      var set = EnumSet.noneOf(Kit.class);
      for (var kit : kits) {
        set.add(Kit.valueOf(kit.toUpperCase(Locale.ROOT)));
      }
      return set;
    }
  }

  /**
   * Perception cost.
   *
   * @param losRayBudgetPerThink the most line-of-sight rays one think job casts
   */
  public record Awareness(int losRayBudgetPerThink) {}

  /**
   * Decision trace recording.
   *
   * @param enabled whether traces are written
   * @param directory the folder under the plugin data folder, one plain name
   * @param queueCapacity how many trace lines may wait for the writer before new ones are dropped
   */
  public record Traces(boolean enabled, String directory, int queueCapacity) {

    private static final Pattern DIRECTORY = Pattern.compile("[A-Za-z0-9_-]+");

    public Traces {
      if (!DIRECTORY.matcher(directory).matches()) {
        throw new IllegalArgumentException("directory must be one plain folder name: " + directory);
      }
      if (queueCapacity < 1) {
        throw new IllegalArgumentException("queueCapacity must be positive");
      }
    }
  }

  /**
   * Bot chat in the match world; also gated by the managed Flipt flag {@code
   * the-storm-rwfbots-chat-enabled}.
   *
   * @param enabled whether bots talk at all; when false the flag is never evaluated
   * @param flagRefreshSeconds how often the flag is evaluated again
   * @param chances the base chance, 0..1, a bot speaks at each moment
   * @param verbosity the factor each personality verbosity applies to every chance
   * @param rivalBoost the factor, 1..4, for a line aimed at a rival or a grudge
   * @param botCooldownSeconds the least time between two lines by one bot
   * @param windowSeconds the span the global line budget covers
   * @param maxLinesPerWindow the most lines all bots together say within one window
   * @param minGapMillis the least time between any two lines
   * @param reactionMinMillis the shortest delay between a moment and its line
   * @param reactionMaxMillis the longest delay between a moment and its line
   * @param maxDelayMillis a line the rate limit would push later than this is dropped
   * @param recentDeathSeconds how long after dying a bot may still speak
   * @param tauntEverySeconds the mean time between idle taunt chances
   */
  public record Chat(
      boolean enabled,
      int flagRefreshSeconds,
      Chances chances,
      VerbosityFactors verbosity,
      double rivalBoost,
      int botCooldownSeconds,
      int windowSeconds,
      int maxLinesPerWindow,
      int minGapMillis,
      int reactionMinMillis,
      int reactionMaxMillis,
      int maxDelayMillis,
      int recentDeathSeconds,
      int tauntEverySeconds) {

    public Chat {
      if (flagRefreshSeconds < 1) {
        throw new IllegalArgumentException("chat.flagRefreshSeconds must be at least 1");
      }
    }

    public ChatSettings toSettings() {
      return new ChatSettings(
          chances.byMoment(),
          verbosity.byLevel(),
          rivalBoost,
          Duration.ofSeconds(botCooldownSeconds),
          Duration.ofSeconds(windowSeconds),
          maxLinesPerWindow,
          Duration.ofMillis(minGapMillis),
          Duration.ofMillis(reactionMinMillis),
          Duration.ofMillis(reactionMaxMillis),
          Duration.ofMillis(maxDelayMillis),
          Duration.ofSeconds(recentDeathSeconds),
          Duration.ofSeconds(tauntEverySeconds));
    }
  }

  /** The base chance, 0..1, per moment, keyed as the personality files key their line pools. */
  public record Chances(
      double greet,
      double onKill,
      double onDeath,
      double onPlant,
      double onDefuse,
      double onWin,
      double onLoss,
      double onLastAlive,
      double taunt,
      double lobby) {

    public Map<Lines.Moment, Double> byMoment() {
      return Map.of(
          Lines.Moment.GREET, greet,
          Lines.Moment.ON_KILL, onKill,
          Lines.Moment.ON_DEATH, onDeath,
          Lines.Moment.ON_PLANT, onPlant,
          Lines.Moment.ON_DEFUSE, onDefuse,
          Lines.Moment.ON_WIN, onWin,
          Lines.Moment.ON_LOSS, onLoss,
          Lines.Moment.ON_LAST_ALIVE, onLastAlive,
          Lines.Moment.TAUNT, taunt,
          Lines.Moment.LOBBY, lobby);
    }
  }

  /** The factor each personality verbosity applies to every chance. */
  public record VerbosityFactors(double quiet, double normal, double chatty) {

    public Map<Voice.Verbosity, Double> byLevel() {
      return Map.of(
          Voice.Verbosity.QUIET, quiet,
          Voice.Verbosity.NORMAL, normal,
          Voice.Verbosity.CHATTY, chatty);
    }
  }

  public ThinkRates thinkRates() {
    return new ThinkRates(
        think.perceptionEveryTicks(),
        think.tacticsEveryTicks(),
        think.teamEveryTicks(),
        think.maxDecisionAgeTicks(),
        awareness.losRayBudgetPerThink());
  }

  /** The kit id rwf knows {@code kit} by. */
  public static String kitId(Kit kit) {
    return kit.name().toLowerCase(Locale.ROOT);
  }
}
