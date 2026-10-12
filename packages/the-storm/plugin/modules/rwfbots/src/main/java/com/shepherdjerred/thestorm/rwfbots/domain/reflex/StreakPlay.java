package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

/**
 * When a bot calls in a killstreak reward it carries (a supply crate, attack dogs, an iron golem,
 * napalm): on solid ground with no enemy in sight, so it is not caught with its hands full, and no
 * sooner than {@link #GAP_TICKS} after the last one. A pure function of the tick's input.
 */
public final class StreakPlay {

  /** The fewest ticks between two calls. */
  public static final int GAP_TICKS = 100;

  private StreakPlay() {}

  /**
   * Whether to call in a reward now.
   *
   * @param carried how many rewards the bot carries
   * @param input the tick's input
   * @param next the earliest tick it may call one in
   */
  public static boolean now(int carried, ReflexInput input, long next) {
    return carried > 0
        && input.snapshot().tick() >= next
        && input.target().isEmpty()
        && input.self().alive()
        && input.self().onGround();
  }
}
