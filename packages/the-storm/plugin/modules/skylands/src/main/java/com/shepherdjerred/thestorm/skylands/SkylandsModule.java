package com.shepherdjerred.thestorm.skylands;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.skylands.adapter.paper.SkylandsWorlds;
import com.shepherdjerred.thestorm.skylands.app.SkylandsAssets;
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
    context
        .services()
        .require(com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry.class)
        .stateless(id());
    var config = context.loadConfig("skylands.json", SkylandsConfig.class);
    var world =
        SkylandsWorlds.install(
            context.plugin(), config, context.services().require(SkylandsAssets.class));
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
