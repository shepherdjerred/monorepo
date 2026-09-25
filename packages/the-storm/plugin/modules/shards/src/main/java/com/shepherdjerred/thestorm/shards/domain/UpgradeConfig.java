package com.shepherdjerred.thestorm.shards.domain;

import java.time.Duration;
import java.util.List;

/**
 * The upgrade ladder, Storm I to Storm V.
 *
 * @param tiers one rule per tier, Storm I first
 * @param broadcastFromTier the lowest tier whose success is announced to the whole server
 * @param loreLine the MiniMessage lore line upgraded gear shows; {@code <tier>} is the numeral
 * @param attemptCooldownMillis the least time between one player's altar attempts, so one click
 *     never pays twice
 */
public record UpgradeConfig(
    List<TierRule> tiers, int broadcastFromTier, String loreLine, int attemptCooldownMillis) {

  public UpgradeConfig {
    tiers = List.copyOf(tiers);
    Checks.perTier("upgrades.tiers", tiers);
    if (broadcastFromTier < 1 || broadcastFromTier > StormTier.MAX_LEVEL + 1) {
      throw new IllegalArgumentException(
          "upgrades.broadcastFromTier must be 1.."
              + (StormTier.MAX_LEVEL + 1)
              + " ("
              + (StormTier.MAX_LEVEL + 1)
              + " never broadcasts) but was "
              + broadcastFromTier);
    }
    Checks.template("upgrades.loreLine", loreLine, "tier");
    if (attemptCooldownMillis < 250) {
      throw new IllegalArgumentException(
          "upgrades.attemptCooldownMillis must be at least 250 (five ticks, longer than the"
              + " four-tick right-click repeat) but was "
              + attemptCooldownMillis);
    }
  }

  /** The rule for reaching {@code tier}. */
  public TierRule rule(StormTier tier) {
    return tiers.get(tier.index());
  }

  /** The least time between one player's attempts. */
  public Duration attemptCooldown() {
    return Duration.ofMillis(attemptCooldownMillis);
  }
}
