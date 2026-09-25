package com.shepherdjerred.thestorm.arena.domain.geometry;

/**
 * A chunk column, by chunk coordinates (block coordinates divided by 16, rounded down).
 *
 * @param x the chunk's x
 * @param z the chunk's z
 */
public record ChunkPos(int x, int z) {}
