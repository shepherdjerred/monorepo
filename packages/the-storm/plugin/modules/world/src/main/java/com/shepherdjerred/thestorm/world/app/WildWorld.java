package com.shepherdjerred.thestorm.world.app;

/**
 * A world this module created.
 *
 * @param name the world name
 * @param rtp whether random teleport may land here
 * @param spawnX spawn block x, the point random teleport measures from when nothing is claimed
 * @param spawnZ spawn block z
 */
public record WildWorld(String name, boolean rtp, int spawnX, int spawnZ) {}
