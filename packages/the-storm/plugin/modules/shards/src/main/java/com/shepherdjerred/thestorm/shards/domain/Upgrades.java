package com.shepherdjerred.thestorm.shards.domain;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.shards.domain.UpgradeOutcome.Failed;
import com.shepherdjerred.thestorm.shards.domain.UpgradeOutcome.Shattered;
import com.shepherdjerred.thestorm.shards.domain.UpgradeOutcome.Upgraded;
import com.shepherdjerred.thestorm.shards.domain.UpgradeRefusal.AtMaxTier;
import com.shepherdjerred.thestorm.shards.domain.UpgradeRefusal.NoStorm;
import com.shepherdjerred.thestorm.shards.domain.UpgradeRefusal.NotEnoughShards;
import com.shepherdjerred.thestorm.shards.domain.UpgradeRefusal.NotUpgradeable;
import java.util.random.RandomGenerator;

/** The altar's upgrade rules. */
public final class Upgrades {

  private final UpgradeConfig config;

  public Upgrades(UpgradeConfig config) {
    this.config = config;
  }

  /**
   * Attempts an upgrade. Refusals are checked in the order a player would fix them: the item, its
   * tier, the weather, then the shards. An accepted attempt always spends the tier's cost; one roll
   * then decides between breaking, failing and succeeding.
   */
  public Result<UpgradeOutcome, UpgradeRefusal> attempt(
      UpgradeRequest request, RandomGenerator random) {
    if (request.category().isEmpty()) {
      return Result.err(new NotUpgradeable());
    }
    var next = StormTier.after(request.current());
    if (next.isEmpty()) {
      return Result.err(new AtMaxTier());
    }
    if (!request.storming()) {
      return Result.err(new NoStorm());
    }
    var tier = next.get();
    var rule = config.rule(tier);
    if (request.shardsHeld() < rule.cost()) {
      return Result.err(new NotEnoughShards(tier, rule.cost(), request.shardsHeld()));
    }
    var roll = random.nextDouble();
    if (roll < rule.breakChance()) {
      return Result.ok(new Shattered(tier, rule.cost()));
    }
    if (roll < rule.breakChance() + rule.failChance()) {
      return Result.ok(new Failed(tier, rule.cost()));
    }
    return Result.ok(new Upgraded(tier, rule.cost()));
  }

  /** The shards needed to reach {@code tier}. */
  public int cost(StormTier tier) {
    return config.rule(tier).cost();
  }

  /** Whether reaching {@code tier} is announced to the server. */
  public boolean broadcasts(StormTier tier) {
    return tier.level() >= config.broadcastFromTier();
  }

  /** How many (harmless) lightning bolts mark reaching {@code tier}: one per level. */
  public static int lightningStrikes(StormTier tier) {
    return tier.level();
  }
}
