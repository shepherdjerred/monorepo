package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;

/**
 * What the reflex layer needs that does not change during a life.
 *
 * @param grid the map, for hit tests and bow lines
 * @param levers the bot's levers
 * @param loadout where the kit's items sit
 */
public record ReflexContext(VoxelGrid grid, Levers levers, Loadout loadout) {}
