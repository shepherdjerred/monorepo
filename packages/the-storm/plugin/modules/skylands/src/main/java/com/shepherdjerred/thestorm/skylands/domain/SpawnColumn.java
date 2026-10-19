package com.shepherdjerred.thestorm.skylands.domain;

/**
 * A block column chosen for the world spawn.
 *
 * @param x block x
 * @param top Beta y of the column's highest stone
 * @param z block z
 */
public record SpawnColumn(int x, int top, int z) {}
