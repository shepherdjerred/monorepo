package com.shepherdjerred.thestorm.qol.domain.sleep;

import java.util.List;

/**
 * Skipping the night when enough players sleep. With 1-3 players online, waiting for everyone is
 * waiting for whoever is away, so players marked AFK do not count unless they are in bed, and a
 * share of the rest (rounded up, at least one) is enough.
 */
public final class SleepVote {

  /** Ticks in a Minecraft day. */
  public static final long DAY = 24_000;

  private final int percent;

  /** Needs {@code percent} (1-100) of the counted players asleep. */
  public SleepVote(int percent) {
    if (percent < 1 || percent > 100) {
      throw new IllegalArgumentException("percent must be 1-100: " + percent);
    }
    this.percent = percent;
  }

  /**
   * One player in the world.
   *
   * @param sleeping in a bed
   * @param deeplySleeping in a bed long enough for the night to pass (vanilla's five seconds)
   * @param afk marked away
   * @param ignored never counted: spectators and players vanilla ignores for sleep
   */
  public record Sleeper(boolean sleeping, boolean deeplySleeping, boolean afk, boolean ignored) {

    boolean counts() {
      return !ignored && (sleeping || !afk);
    }
  }

  /**
   * The count in one world.
   *
   * @param counted players who count: not ignored, and awake-and-present or in bed
   * @param sleeping counted players in bed
   * @param deeplySleeping counted players asleep long enough
   * @param needed how many must be asleep; 0 when nobody counts
   */
  public record Tally(int counted, int sleeping, int deeplySleeping, int needed) {

    /** Whether the night passes now. */
    public boolean skips() {
      return needed > 0 && deeplySleeping >= needed;
    }
  }

  public Tally tally(List<Sleeper> players) {
    var counted = 0;
    var sleeping = 0;
    var deeply = 0;
    for (var player : players) {
      if (!player.counts()) {
        continue;
      }
      counted++;
      if (player.sleeping()) {
        sleeping++;
      }
      if (player.sleeping() && player.deeplySleeping()) {
        deeply++;
      }
    }
    return new Tally(counted, sleeping, deeply, needed(counted));
  }

  /** How many of {@code counted} players must sleep: the share rounded up, at least one. */
  public int needed(int counted) {
    if (counted <= 0) {
      return 0;
    }
    return Math.max(1, (counted * percent + 99) / 100);
  }

  /** The next sunrise after {@code fullTime}, as vanilla skips to it. */
  public static long nextMorning(long fullTime) {
    return fullTime + DAY - Math.floorMod(fullTime, DAY);
  }
}
