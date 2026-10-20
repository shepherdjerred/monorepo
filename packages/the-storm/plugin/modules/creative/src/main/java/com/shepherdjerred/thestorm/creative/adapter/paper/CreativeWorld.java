package com.shepherdjerred.thestorm.creative.adapter.paper;

import com.shepherdjerred.thestorm.creative.domain.CreativeConfig;
import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import org.bukkit.GameRules;
import org.bukkit.World;

/** Rules that keep the creative world from behaving like survival. */
public final class CreativeWorld {

  private CreativeWorld() {}

  /** Seals daylight, weather and mobs, keeps inventory, and sets the surveyed border and spawn. */
  public static void apply(World world, CreativeConfig config) {
    world.setGameRule(GameRules.ADVANCE_TIME, false);
    world.setGameRule(GameRules.ADVANCE_WEATHER, false);
    world.setGameRule(GameRules.SPAWN_MOBS, false);
    world.setGameRule(GameRules.KEEP_INVENTORY, true);
    world.setStorm(false);
    world.setThundering(false);
    world.setSpawnLocation(PlotGrid.SPAWN_X, PlotGrid.SPAWN_Y, PlotGrid.SPAWN_Z);
    var border = world.getWorldBorder();
    border.setCenter(config.borderCenterX(), config.borderCenterZ());
    border.setSize(config.borderSize());
  }
}
