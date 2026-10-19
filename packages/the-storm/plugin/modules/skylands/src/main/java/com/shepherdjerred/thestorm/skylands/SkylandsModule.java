package com.shepherdjerred.thestorm.skylands;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.skylands.adapter.paper.SkylandsWorlds;
import com.shepherdjerred.thestorm.skylands.app.SkylandsWorld;
import com.shepherdjerred.thestorm.skylands.domain.SkylandsConfig;

/**
 * Creates or loads the skylands world with its generator and publishes {@link SkylandsWorld}.
 * Modules that use the world come after this one.
 */
public final class SkylandsModule implements StormModule {

  @Override
  public String id() {
    return "skylands";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("skylands.yml", SkylandsConfig.class);
    var world = SkylandsWorlds.install(context.plugin(), config);
    context.services().provide(SkylandsWorld.class, new SkylandsWorld(world.getName()));
    context
        .logger()
        .info(
            "{} module loaded {} (seed {}, spawn {})",
            id(),
            world.getName(),
            world.getSeed(),
            world.getSpawnLocation().toVector());
  }
}
