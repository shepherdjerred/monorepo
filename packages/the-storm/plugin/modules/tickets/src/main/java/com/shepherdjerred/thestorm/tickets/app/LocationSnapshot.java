package com.shepherdjerred.thestorm.tickets.app;

/**
 * Where a ticket happened, as other modules see it.
 *
 * @param world the world name
 * @param x the block x
 * @param y the block y
 * @param z the block z
 */
public record LocationSnapshot(String world, int x, int y, int z) {}
