package com.shepherdjerred.thestorm.shards.domain;

/** Why the altar would not attempt an upgrade. Nothing is consumed. */
public sealed interface UpgradeRefusal {

  /** The held item is not upgradeable gear. */
  record NotUpgradeable() implements UpgradeRefusal {}

  /** The item is already Storm V. */
  record AtMaxTier() implements UpgradeRefusal {}

  /** It is not raining at the altar. */
  record NoStorm() implements UpgradeRefusal {}

  /** The player has too few shards for the next tier. */
  record NotEnoughShards(StormTier tier, int needed, int held) implements UpgradeRefusal {}
}
