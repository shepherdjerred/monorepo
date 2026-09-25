package com.shepherdjerred.thestorm.world;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.world.adapter.paper.WorldPaper;
import com.shepherdjerred.thestorm.world.app.WildWorlds;
import com.shepherdjerred.thestorm.world.domain.WorldConfig;

/** Creates the extra overworlds and publishes {@link WildWorlds}. */
public final class WorldModule implements StormModule {

  @Override
  public String id() {
    return "world";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("world.yml", WorldConfig.class);
    var worlds = WorldPaper.install(context.plugin().getServer(), config);
    context.services().provide(WildWorlds.class, worlds);
    context.logger().info("{} module created {}", id(), worlds.defaultWorld().name());
  }
}
