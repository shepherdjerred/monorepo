package com.shepherdjerred.thestorm.skylands.domain;

/**
 * One ore block to set.
 *
 * @param x chunk-local x
 * @param y Beta terrain y
 * @param z chunk-local z
 * @param vein index of the {@link OreVein} it belongs to
 */
public record OrePlacement(int x, int y, int z, int vein) {}
