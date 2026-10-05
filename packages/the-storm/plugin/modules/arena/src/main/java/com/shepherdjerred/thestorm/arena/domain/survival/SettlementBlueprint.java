package com.shepherdjerred.thestorm.arena.domain.survival;

import static com.shepherdjerred.thestorm.arena.domain.survival.SettlementBlocks.at;
import static java.util.Collections.unmodifiableMap;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import java.util.LinkedHashMap;
import java.util.Map;

/** A three-tier coastal town arranged around a cathedral, with a separately gated crypt. */
public final class SettlementBlueprint {
  public static final int BLOCK_BUDGET = 2_100_000;
  private final SurvivalContent content;
  private final Map<BlockPos, String> blocks = new LinkedHashMap<>();

  public SettlementBlueprint(SurvivalContent content) {
    if (!content.arena().id().equals("settlement"))
      throw new IllegalArgumentException("Settlement needs its authored map content");
    this.content = content;
  }

  public Map<BlockPos, String> blocks() {
    if (blocks.isEmpty()) {
      var build = new SettlementBlocks(content.arena().region(), blocks);
      new SettlementTerrain(content, build).apply();
      new SettlementTown(build).apply();
      new SettlementChurch(build).apply();
      new SettlementTerrain(content, build).arrivals();
      new SettlementFixtures(content, blocks).apply();
      new SettlementTerrain(content, build).supports();
      boxHousings(build);
      blocks.replaceAll(
          (pos, material) -> material.equals("COPPER_BLOCK") ? "WAXED_COPPER_BLOCK" : material);
      var exit = content.arena().exit().point().block();
      blocks.put(new BlockPos(exit.x(), exit.y() - 1, exit.z()), "STONE_BRICKS");
      blocks.put(exit, "AIR");
      blocks.put(new BlockPos(exit.x(), exit.y() + 1, exit.z()), "AIR");
      if (blocks.size() > BLOCK_BUDGET)
        throw new IllegalArgumentException("Settlement exceeds its reviewed block budget");
    }
    return unmodifiableMap(blocks);
  }

  private void boxHousings(SettlementBlocks build) {
    for (var site : content.boxSites()) {
      var at = site.block();
      for (var dx : new int[] {-1, 1})
        for (var dz : new int[] {-1, 1})
          build.box(
              at(at.x() + dx, at.y(), at.z() + dz),
              at(at.x() + dx, site.beacon().y() - 2, at.z() + dz),
              "STRIPPED_DARK_OAK_LOG");
      boxCap(build, site.beacon());
      build.put(site.beacon().x() - 1, site.beacon().y(), site.beacon().z() - 1, "SEA_LANTERN");
    }
  }

  private static void boxCap(SettlementBlocks build, BlockPos beacon) {
    for (var delta :
        new int[][] {{-1, -1}, {-1, 0}, {-1, 1}, {0, -1}, {0, 1}, {1, -1}, {1, 0}, {1, 1}})
      build.box(
          at(beacon.x() + delta[0], beacon.y(), beacon.z() + delta[1]),
          at(beacon.x() + delta[0], beacon.y() + 1, beacon.z() + delta[1]),
          "DARK_OAK_PLANKS");
  }
}
