package com.shepherdjerred.thestorm.shards.domain;

/** What the storm did to an item at the altar. Every outcome spends the tier's shards. */
public sealed interface UpgradeOutcome {

  /** The tier that was attempted. */
  StormTier tier();

  /** Shards consumed. */
  int shardsSpent();

  /** The item reached {@code tier}. */
  record Upgraded(StormTier tier, int shardsSpent) implements UpgradeOutcome {}

  /** The storm fizzled: shards spent, item unchanged. */
  record Failed(StormTier tier, int shardsSpent) implements UpgradeOutcome {}

  /** The storm destroyed the item. */
  record Shattered(StormTier tier, int shardsSpent) implements UpgradeOutcome {}
}
