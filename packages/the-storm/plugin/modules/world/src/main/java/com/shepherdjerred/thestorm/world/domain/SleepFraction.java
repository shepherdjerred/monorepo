package com.shepherdjerred.thestorm.world.domain;

/**
 * Whether enough of the players in one overworld are in bed to skip the night. This is the rule
 * {@code playersSleepingPercentage} enforces; there is no sleep command.
 */
public final class SleepFraction {

  private SleepFraction() {}

  /**
   * True when {@code sleeping} is at least {@code percentage} of {@code awake}. One sleeper of one,
   * or one of two, passes at 50. One of three does not.
   */
  public static boolean skips(int sleeping, int awake, int percentage) {
    if (percentage < 1 || percentage > 100) {
      throw new IllegalArgumentException("percentage must be 1-100: " + percentage);
    }
    if (sleeping < 0 || awake < 0 || sleeping > awake) {
      throw new IllegalArgumentException("sleeping " + sleeping + " of awake " + awake);
    }
    if (awake == 0 || sleeping == 0) {
      return false;
    }
    return sleeping * 100L >= (long) awake * percentage;
  }
}
