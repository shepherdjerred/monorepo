package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import java.util.Optional;

/**
 * What the think step carries between thinks.
 *
 * @param plan the plan in progress
 * @param lastThinkTick when the bot last thought, or -1
 * @param lifeEpoch how many times the bot has spawned
 */
public record TacticsState(Optional<Plan> plan, long lastThinkTick, int lifeEpoch) {

  public static TacticsState fresh(int lifeEpoch) {
    return new TacticsState(Optional.empty(), -1, lifeEpoch);
  }
}
