package com.shepherdjerred.thestorm.world;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.world.adapter.paper.CrierCommands;
import com.shepherdjerred.thestorm.world.adapter.paper.WorldPaper;
import com.shepherdjerred.thestorm.world.app.WildWorlds;
import com.shepherdjerred.thestorm.world.domain.WorldConfig;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;

/**
 * Creates the extra overworlds, publishes {@link WildWorlds}, and optionally registers the crier.
 */
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
    if (config.crier().enabled()) {
      var crier = new CrierCommands(context.plugin().getServer(), config.crier());
      context
          .lifecycle()
          .registerEventHandler(
              LifecycleEvents.COMMANDS, event -> crier.register(event.registrar()));
    }
    context.logger().info("{} module created {}", id(), worlds.defaultWorld().name());
  }
}
