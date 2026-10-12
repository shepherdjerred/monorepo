package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import java.util.Optional;

/**
 * What the think step carries between thinks.
 *
 * @param plan the plan in progress
 * @param lastThinkTick when the bot last thought, or -1
 * @param lifeEpoch how many times the bot has spawned
 * @param bornTick when the bot first thought in the match, or -1
 * @param rewind the bot's model of its Time Machine
 */
public record TacticsState(
    Optional<Plan> plan, long lastThinkTick, int lifeEpoch, long bornTick, RewindClock rewind) {

  public static TacticsState fresh(int lifeEpoch) {
    return new TacticsState(Optional.empty(), -1, lifeEpoch, -1, RewindClock.UNSTARTED);
  }

  /**
   * A new life (a death, a teleport, a landed rewind): the plan is dropped; when the match began
   * for the bot and its Time Machine's cooldown carry over, as rwf's do.
   */
  public TacticsState nextLife(int newEpoch) {
    return new TacticsState(Optional.empty(), lastThinkTick, newEpoch, bornTick, rewind);
  }
}
