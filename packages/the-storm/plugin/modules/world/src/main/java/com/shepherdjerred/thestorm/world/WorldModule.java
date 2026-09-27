package com.shepherdjerred.thestorm.world;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.world.adapter.paper.CrierCommands;
import com.shepherdjerred.thestorm.world.adapter.paper.WorldPaper;
import com.shepherdjerred.thestorm.world.adapter.remote.FliptCrierGate;
import com.shepherdjerred.thestorm.world.app.CrierGate;
import com.shepherdjerred.thestorm.world.app.WildWorlds;
import com.shepherdjerred.thestorm.world.domain.WorldConfig;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.net.URI;
import org.jspecify.annotations.Nullable;

/**
 * Creates the extra overworlds, publishes {@link WildWorlds}, and optionally registers the crier.
 */
public final class WorldModule implements StormModule {

  private @Nullable FliptCrierGate gate;

  @Override
  public String id() {
    return "world";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("world.yml", WorldConfig.class);
    var worlds = WorldPaper.install(context.plugin().getServer(), config);
    context.services().provide(WildWorlds.class, worlds);
    var base = System.getenv("FLIPT_URL");
    var environment = System.getenv("FLIPT_ENVIRONMENT");
    CrierGate rollout;
    if (base == null || base.isBlank() || environment == null || environment.isBlank()) {
      rollout = player -> java.util.concurrent.CompletableFuture.completedFuture(false);
    } else {
      var remote = new FliptCrierGate(URI.create(base), environment);
      gate = remote;
      rollout = remote;
    }
    var crier =
        new CrierCommands(
            context.plugin().getServer(),
            config.crier(),
            new CrierCommands.Ports(rollout, context.scheduler(), context.logger()));
    context
        .lifecycle()
        .registerEventHandler(LifecycleEvents.COMMANDS, event -> crier.register(event.registrar()));
    context.logger().info("{} module created {}", id(), worlds.defaultWorld().name());
  }

  @Override
  public void disable() {
    if (gate != null) {
      gate.close();
      gate = null;
    }
  }
}
