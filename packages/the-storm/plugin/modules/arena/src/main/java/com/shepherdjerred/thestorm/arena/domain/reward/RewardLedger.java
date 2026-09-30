package com.shepherdjerred.thestorm.arena.domain.reward;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Crystals paid to each player in the current game, so the per-game cap holds.
 *
 * @param paid player to crystals paid so far this game
 */
public record RewardLedger(Map<UUID, Long> paid) {

  public static final RewardLedger EMPTY = new RewardLedger(Map.of());

  public RewardLedger {
    paid = Map.copyOf(paid);
  }

  /** What {@code player} has been paid this game. */
  public long paidTo(UUID player) {
    return paid.getOrDefault(player, 0L);
  }

  /**
   * Grants up to {@code amount} to {@code player} without passing {@code cap} for the game.
   *
   * @return what is actually granted (possibly 0) and the updated ledger
   */
  public Grant grant(UUID player, long amount, long cap) {
    if (amount < 0 || cap < 0) {
      throw new IllegalArgumentException("amounts must not be negative");
    }
    var granted = Math.max(0, Math.min(amount, cap - paidTo(player)));
    if (granted == 0) {
      return new Grant(0, this);
    }
    var next = new HashMap<>(paid);
    next.merge(player, granted, Long::sum);
    return new Grant(granted, new RewardLedger(next));
  }

  /**
   * The result of {@link #grant}.
   *
   * @param amount crystals to pay now
   * @param ledger the ledger after paying them
   */
  public record Grant(long amount, RewardLedger ledger) {}
}
