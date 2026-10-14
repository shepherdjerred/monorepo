package com.shepherdjerred.thestorm.rwf.domain.killstreak;

import static java.util.Comparator.comparingInt;

import java.util.List;

/** Three rewards at distinct kill thresholds, frozen when a combatant's life begins. */
public record StreakLoadout(List<Killstreak> rewards) {
  public static final int SIZE = 3;
  public static final StreakLoadout DEFAULT =
      new StreakLoadout(
          List.of(Killstreak.COMPASS, Killstreak.SUPPLY_CRATE, Killstreak.IRON_GOLEM));

  public StreakLoadout {
    rewards = List.copyOf(rewards);
    if (rewards.size() != SIZE
        || rewards.stream().map(Killstreak::kills).distinct().count() != SIZE) {
      throw new IllegalArgumentException("Choose three rewards with different kill thresholds");
    }
    rewards = rewards.stream().sorted(comparingInt(Killstreak::kills)).toList();
  }

  /** Each selected threshold is crossed at most once, including fractional assist progress. */
  public List<Killstreak.Earned> earned(int before, int after) {
    return rewards.stream()
        .filter(reward -> before < reward.kills() && reward.kills() <= after)
        .map(reward -> new Killstreak.Earned(reward, reward.kills()))
        .toList();
  }
}
