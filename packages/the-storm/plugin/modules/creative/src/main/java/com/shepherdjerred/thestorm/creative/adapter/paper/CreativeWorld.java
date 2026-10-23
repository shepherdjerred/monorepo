package com.shepherdjerred.thestorm.creative.adapter.paper;

import com.shepherdjerred.thestorm.creative.domain.CreativeConfig;
import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import org.bukkit.GameRules;
import org.bukkit.World;

/** Rules that keep the creative world from behaving like survival. */
public final class CreativeWorld {

  private CreativeWorld() {}

  /**
   * Freezes the pasted terrain, keeps inventory, and sets the surveyed border and spawn. Random
   * ticks are what decay leaves. A fire-spread radius of zero is the 1.21.11 replacement for {@code
   * doFireTick}.
   */
  public static void apply(World world, CreativeConfig config) {
    world.setGameRule(GameRules.ADVANCE_TIME, false);
    world.setGameRule(GameRules.ADVANCE_WEATHER, false);
    world.setGameRule(GameRules.SPAWN_MOBS, false);
    world.setGameRule(GameRules.KEEP_INVENTORY, true);
    world.setGameRule(GameRules.RANDOM_TICK_SPEED, 0);
    world.setGameRule(GameRules.FIRE_SPREAD_RADIUS_AROUND_PLAYER, 0);
    world.setGameRule(GameRules.MOB_GRIEFING, false);
    world.setGameRule(GameRules.TNT_EXPLODES, false);
    world.setGameRule(GameRules.SPREAD_VINES, false);
    world.setGameRule(GameRules.MAX_SNOW_ACCUMULATION_HEIGHT, 0);
    world.setGameRule(GameRules.LAVA_SOURCE_CONVERSION, false);
    world.setGameRule(GameRules.WATER_SOURCE_CONVERSION, false);
    world.setGameRule(GameRules.PROJECTILES_CAN_BREAK_BLOCKS, false);
    world.setStorm(false);
    world.setThundering(false);
    world.setSpawnLocation(PlotGrid.SPAWN_X, PlotGrid.SPAWN_Y, PlotGrid.SPAWN_Z);
    var border = world.getWorldBorder();
    border.setCenter(config.borderCenterX(), config.borderCenterZ());
    border.setSize(config.borderSize());
  }
}
