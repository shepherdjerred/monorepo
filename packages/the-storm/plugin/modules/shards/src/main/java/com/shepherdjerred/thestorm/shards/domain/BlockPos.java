package com.shepherdjerred.thestorm.shards.domain;

/**
 * A block position.
 *
 * @param world the world key, such as {@code minecraft:overworld}
 * @param x block x
 * @param y block y
 * @param z block z
 */
public record BlockPos(String world, int x, int y, int z) {}
