package com.shepherdjerred.thestorm.shards.domain;

import java.util.List;

/**
 * {@code plugins/TheStorm/shards.yml}, owned by the repository.
 *
 * @param item how a shard looks
 * @param drops where shards come from
 * @param upgrades the Storm I to V ladder
 * @param altars the blocks that upgrade gear; the first is the spawn windmill's emerald block
 * @param bonuses what upgraded gear does in combat
 * @param messages player-facing text
 */
public record ShardsConfig(
    ShardItemConfig item,
    DropsConfig drops,
    UpgradeConfig upgrades,
    List<AltarLocation> altars,
    BonusConfig bonuses,
    ShardMessages messages) {

  public ShardsConfig {
    altars = List.copyOf(altars);
    Checks.notEmpty("altars", altars);
    Checks.unique("altars", altars);
  }
}
