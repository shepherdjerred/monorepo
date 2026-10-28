package com.shepherdjerred.thestorm.skylands.adapter.paper;

import com.shepherdjerred.thestorm.skylands.domain.SkyPlan;
import com.shepherdjerred.thestorm.skylands.domain.SkyPosition;
import org.bukkit.generator.LimitedRegion;

/** Every custom block and entity belongs to exactly one population callback. */
record LayeredSlice(int x, int z, LimitedRegion region, SkyPlan plan) {
  boolean owns(SkyPosition p) {
    return Math.floorDiv(p.x(), 16) == x && Math.floorDiv(p.z(), 16) == z;
  }
}
