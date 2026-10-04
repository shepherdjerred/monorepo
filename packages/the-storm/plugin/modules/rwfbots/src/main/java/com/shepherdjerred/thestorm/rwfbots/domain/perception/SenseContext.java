package com.shepherdjerred.thestorm.rwfbots.domain.perception;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.map.Regions;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;

/**
 * What perception needs that does not change during a match.
 *
 * @param grid the map's sight layer
 * @param graph the nav graph, to place combatants in regions
 * @param regions the region visibility table used to skip hopeless ray casts
 * @param levers the bot's levers; awareness radius matters here
 */
public record SenseContext(VoxelGrid grid, NavGraph graph, Regions regions, Levers levers) {}
