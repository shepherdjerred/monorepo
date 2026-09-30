package com.shepherdjerred.thestorm.shards.domain;

/**
 * A mob death, as the drop rules see it.
 *
 * @param entityType the Paper entity type, such as {@code ZOMBIE}
 * @param world the world key, such as {@code minecraft:overworld}
 * @param spawnReason the Paper spawn reason, such as {@code NATURAL}
 * @param killedByPlayer whether a player landed the killing blow
 */
public record MobKill(
    String entityType, String world, String spawnReason, boolean killedByPlayer) {}
