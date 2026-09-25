package com.shepherdjerred.thestorm.shards.domain;

import com.shepherdjerred.thestorm.shards.domain.DropOutcome.Dropped;
import com.shepherdjerred.thestorm.shards.domain.DropOutcome.Nothing;
import com.shepherdjerred.thestorm.shards.domain.DropOutcome.Reason;
import java.util.Set;
import java.util.random.RandomGenerator;

/** Decides whether a mob kill or a block break drops Storm Shards. */
public final class ShardDrops {

  private final DropsConfig config;
  private final Set<String> worlds;
  private final Set<String> excludedSpawnReasons;

  public ShardDrops(DropsConfig config) {
    this.config = config;
    this.worlds = Set.copyOf(config.worlds());
    this.excludedSpawnReasons = Set.copyOf(config.excludedSpawnReasons());
  }

  /** Whether blocks of {@code material} can drop shards, so their placement must be tracked. */
  public boolean isBlockSource(String material) {
    return config.blocks().containsKey(material);
  }

  /** Whether mobs of {@code entityType} can drop shards. */
  public boolean isMobSource(String entityType) {
    return config.mobs().containsKey(entityType);
  }

  public DropOutcome evaluate(MobKill kill, RandomGenerator random) {
    if (!worlds.contains(kill.world())) {
      return new Nothing(Reason.WORLD_EXCLUDED);
    }
    var rule = config.mobs().get(kill.entityType());
    if (rule == null) {
      return new Nothing(Reason.NOT_A_SOURCE);
    }
    if (!kill.killedByPlayer()) {
      return new Nothing(Reason.NOT_KILLED_BY_PLAYER);
    }
    if (excludedSpawnReasons.contains(kill.spawnReason())) {
      return new Nothing(Reason.ARTIFICIAL_SPAWN);
    }
    return roll(rule, random);
  }

  public DropOutcome evaluate(BlockBreak broken, RandomGenerator random) {
    if (!worlds.contains(broken.world())) {
      return new Nothing(Reason.WORLD_EXCLUDED);
    }
    var rule = config.blocks().get(broken.material());
    if (rule == null) {
      return new Nothing(Reason.NOT_A_SOURCE);
    }
    if (!broken.dropsItems()) {
      return new Nothing(Reason.NO_ITEM_DROPS);
    }
    if (broken.placedByPlayer()) {
      return new Nothing(Reason.PLACED_BY_PLAYER);
    }
    if (broken.silkTouch()) {
      return new Nothing(Reason.SILK_TOUCH);
    }
    return roll(rule, random);
  }

  private static DropOutcome roll(DropRule rule, RandomGenerator random) {
    var amount = rule.roll(random);
    return amount.isPresent() ? new Dropped(amount.getAsInt()) : new Nothing(Reason.UNLUCKY);
  }
}
