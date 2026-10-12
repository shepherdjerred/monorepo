package com.shepherdjerred.thestorm.arena.domain.survival;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Cumulative rounding preserves round income without randomly withholding individual rewards. */
public final class ScaledBounties {
  public record Reward(int emeralds, int materials, int experience) {}

  private final int original;
  private final int enlarged;
  private final Map<UUID, Integer> kills = new HashMap<>();

  public ScaledBounties(int original, int enlarged) {
    if (original < 1 || enlarged < original) throw new IllegalArgumentException("Invalid counts");
    this.original = original;
    this.enlarged = enlarged;
  }

  public Reward next(UUID player) {
    var count = kills.merge(player, 1, Integer::sum);
    return new Reward(amount(count, 2), amount(count, 1), amount(count, 2));
  }

  private int amount(int count, int base) {
    return (int)
        ((long) count * base * original / enlarged
            - (long) (count - 1) * base * original / enlarged);
  }
}
