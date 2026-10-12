package com.shepherdjerred.thestorm.rwf.app;

/**
 * The managed rollout decisions for Red Warfare's features beyond the core match, each evaluated
 * per player. A failed evaluation leaves the feature off for that player.
 *
 * @param kits the full kit list, the kit shop and the weekly free rotation ({@code
 *     the-storm-rwf-kits-enabled}); off, a player is offered The Storm's first four kits only
 * @param killstreaks killstreak rewards ({@code the-storm-rwf-killstreaks-enabled})
 */
public record FeatureGates(JoinGate kits, JoinGate killstreaks) {

  /** Every feature on, for tests and the load test. */
  public static FeatureGates open() {
    return new FeatureGates(JoinGate.open(), JoinGate.open());
  }
}
