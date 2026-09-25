package com.shepherdjerred.thestorm.shards.domain;

import java.util.List;
import java.util.Map;

/**
 * Where shards come from.
 *
 * @param worlds world keys (such as {@code minecraft:overworld}) where shards can drop; event and
 *     arena worlds stay out
 * @param excludedSpawnReasons Paper spawn reasons whose mobs never drop shards (spawners, eggs,
 *     commands), so farms built on them yield nothing
 * @param mobs drop rules keyed by Paper entity type
 * @param blocks drop rules keyed by Paper block material; deepslate ore variants are listed
 *     separately
 */
public record DropsConfig(
    List<String> worlds,
    List<String> excludedSpawnReasons,
    Map<String, DropRule> mobs,
    Map<String, DropRule> blocks) {

  public DropsConfig {
    worlds = List.copyOf(worlds);
    excludedSpawnReasons = List.copyOf(excludedSpawnReasons);
    mobs = Map.copyOf(mobs);
    blocks = Map.copyOf(blocks);
    Checks.notEmpty("drops.worlds", worlds);
    Checks.unique("drops.worlds", worlds);
    worlds.forEach(world -> Checks.key("drops.worlds", world));
    Checks.unique("drops.excludedSpawnReasons", excludedSpawnReasons);
    excludedSpawnReasons.forEach(reason -> Checks.constant("drops.excludedSpawnReasons", reason));
    mobs.keySet().forEach(mob -> Checks.constant("drops.mobs", mob));
    blocks.keySet().forEach(block -> Checks.constant("drops.blocks", block));
    if (mobs.isEmpty() && blocks.isEmpty()) {
      throw new IllegalArgumentException("drops needs at least one mob or block source");
    }
  }
}
