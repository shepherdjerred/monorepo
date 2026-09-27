package com.shepherdjerred.thestorm.mobs.domain.config;

import com.shepherdjerred.thestorm.mobs.domain.spawn.AdminPolicy;
import java.util.List;

/**
 * Admin regions, such as the spawn town, and what happens to hostile mobs in them.
 *
 * <p>Land protection offers no "which region is this" lookup, so each region is named by one point
 * inside it: a mob is in the region when protection says it stands on the same land as that point.
 * A point that is not on protected land is ignored (and logged), so a misplaced point can never
 * turn the whole wilderness into a region.
 *
 * @param policy what happens to hostile mobs spawning in a region
 * @param anchors one point inside each admin region
 */
public record AdminRegions(AdminPolicy policy, List<Anchor> anchors) {

  /**
   * A point inside an admin region.
   *
   * @param world the world name
   * @param x block x
   * @param y block y
   * @param z block z
   */
  public record Anchor(String world, int x, int y, int z) {

    public Anchor {
      if (world.isBlank()) {
        throw new IllegalArgumentException("anchor world must not be blank");
      }
    }
  }

  public AdminRegions {
    anchors = List.copyOf(anchors);
  }
}
