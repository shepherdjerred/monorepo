package com.shepherdjerred.thestorm.seasonal;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.seasonal.adapter.paper.SeasonalDoors;
import com.shepherdjerred.thestorm.seasonal.domain.SeasonalConfig;

/** Yearly, date-windowed events in the main world, beginning with Stormnight. */
public final class SeasonalModule implements StormModule {

  @Override
  public String id() {
    return "seasonal";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("seasonal.yml", SeasonalConfig.class);
    var world = context.plugin().getServer().getWorld(config.mainWorld());
    if (world == null) {
      throw new IllegalStateException("Seasonal main world is not loaded: " + config.mainWorld());
    }
    context
        .plugin()
        .getServer()
        .getPluginManager()
        .registerEvents(
            new SeasonalDoors(context.plugin(), config, context.time(), context.random()),
            context.plugin());
    context.logger().info("Loaded {} seasonal events", config.events().size());
  }
}
