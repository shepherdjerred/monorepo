package com.shepherdjerred.thestorm.rwfbots.app;

/**
 * Keeps the bots from costing the server its tick. The main thread reports the server's recent tick
 * time and how long the bot sections took; the governor answers with a level that the think loop,
 * the reflex ticker and the draft read. Levels move only after the condition has held for a run of
 * samples, so a single slow tick never flaps the bots, and the governor never removes a bot from a
 * running round: level 2 only drafts fewer next match.
 *
 * <ul>
 *   <li>Level 0: everything at the configured rates.
 *   <li>Level 1 (p95 tick time above {@code level1Mspt}, or the bot sections above {@code
 *       botSectionMs}): think periods double, and bots with no human within {@code isolationRadius}
 *       blocks run their reflex every other tick.
 *   <li>Level 2 (p95 above {@code level2Mspt}): level 1, and the next match drafts {@code
 *       level2DraftReduction} fewer bots.
 * </ul>
 */
public final class Governor {

  /** The thresholds, all in milliseconds except the counts and the radius in blocks. */
  public record Settings(
      double level1Mspt,
      double level2Mspt,
      double botSectionMs,
      double recoverMspt,
      double recoverBotMs,
      int sustainSamples,
      double isolationRadius,
      int level2DraftReduction) {

    public Settings {
      if (!(level1Mspt > 0) || !(level2Mspt > level1Mspt)) {
        throw new IllegalArgumentException("need 0 < level1Mspt < level2Mspt");
      }
      if (!(recoverMspt > 0) || !(recoverMspt < level1Mspt)) {
        throw new IllegalArgumentException("recoverMspt must be below level1Mspt");
      }
      if (!(botSectionMs > 0) || !(recoverBotMs > 0) || !(recoverBotMs < botSectionMs)) {
        throw new IllegalArgumentException("recoverBotMs must be below botSectionMs");
      }
      if (sustainSamples < 1) {
        throw new IllegalArgumentException("sustainSamples must be at least one");
      }
      if (!(isolationRadius > 0) || level2DraftReduction < 0) {
        throw new IllegalArgumentException("isolationRadius must be positive, reduction >= 0");
      }
    }
  }

  /**
   * One main-thread observation.
   *
   * @param msptP95 the 95th percentile of recent server tick times, milliseconds
   * @param botSectionMs how long the bot sections of the last tick took, milliseconds
   */
  public record Sample(double msptP95, double botSectionMs) {

    public Sample {
      if (!(msptP95 >= 0) || !(botSectionMs >= 0)) {
        throw new IllegalArgumentException("sample times must be non-negative");
      }
    }
  }

  private final Settings settings;
  private volatile int level;
  private int pressureRun;
  private int calmRun;

  public Governor(Settings settings) {
    this.settings = settings;
  }

  public Settings settings() {
    return settings;
  }

  /** The current level, readable from any thread. */
  public int level() {
    return level;
  }

  /** Think periods are multiplied by this. */
  public int thinkPeriodMultiplier() {
    return level >= 1 ? 2 : 1;
  }

  /** Whether bots far from every human reflex every other tick. */
  public boolean thinsIsolatedReflex() {
    return level >= 1;
  }

  /** How many fewer bots the next match drafts. */
  public int draftReduction() {
    return level >= 2 ? settings.level2DraftReduction() : 0;
  }

  /** Feeds one observation; main thread only. Returns the level afterwards. */
  public int observe(Sample sample) {
    var wanted = wanted(sample);
    if (wanted > level) {
      pressureRun++;
      calmRun = 0;
      if (pressureRun >= settings.sustainSamples()) {
        level = wanted;
        pressureRun = 0;
      }
    } else if (wanted < level) {
      calmRun++;
      pressureRun = 0;
      if (calmRun >= settings.sustainSamples()) {
        level = wanted;
        calmRun = 0;
      }
    } else {
      pressureRun = 0;
      calmRun = 0;
    }
    return level;
  }

  /** The level this sample argues for; between the thresholds it argues for staying put. */
  private int wanted(Sample sample) {
    if (sample.msptP95() > settings.level2Mspt()) {
      return 2;
    }
    if (sample.msptP95() > settings.level1Mspt()
        || sample.botSectionMs() > settings.botSectionMs()) {
      return Math.max(1, level);
    }
    if (sample.msptP95() < settings.recoverMspt()
        && sample.botSectionMs() < settings.recoverBotMs()) {
      return Math.max(0, level - 1);
    }
    return level;
  }
}
