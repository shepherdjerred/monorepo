package com.shepherdjerred.thestorm.world;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.world.adapter.bluemap.BlueMapBorders;
import com.shepherdjerred.thestorm.world.adapter.db.JooqDailyLedger;
import com.shepherdjerred.thestorm.world.adapter.paper.AmbientBarks;
import com.shepherdjerred.thestorm.world.adapter.paper.CrierCommands;
import com.shepherdjerred.thestorm.world.adapter.paper.DailyActivityListener;
import com.shepherdjerred.thestorm.world.adapter.paper.DailyDigestCommands;
import com.shepherdjerred.thestorm.world.adapter.paper.EmptyServerArrival;
import com.shepherdjerred.thestorm.world.adapter.paper.WindmillMerchant;
import com.shepherdjerred.thestorm.world.adapter.paper.WorldPaper;
import com.shepherdjerred.thestorm.world.adapter.remote.FlagsCrierGate;
import com.shepherdjerred.thestorm.world.adapter.remote.FlagsMerchantGate;
import com.shepherdjerred.thestorm.world.app.CrierGate;
import com.shepherdjerred.thestorm.world.app.MerchantGate;
import com.shepherdjerred.thestorm.world.app.WildWorlds;
import com.shepherdjerred.thestorm.world.domain.BorderOutline;
import com.shepherdjerred.thestorm.world.domain.WorldConfig;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.net.URI;
import java.util.Optional;
import org.jspecify.annotations.Nullable;

/**
 * Validates the provisioned extra overworlds, publishes {@link WildWorlds}, and registers crier
 * interactions.
 */
public final class WorldModule implements StormModule {

  private @Nullable FlagsCrierGate gate;
  private @Nullable FlagsMerchantGate merchantGate;
  private @Nullable BlueMapBorders borders;

  @Override
  public String id() {
    return "world";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("world.yml", WorldConfig.class);
    var worlds = WorldPaper.install(context.plugin().getServer(), config);
    context
        .plugin()
        .getServer()
        .getPluginManager()
        .registerEvents(new EmptyServerArrival(context.plugin().getServer()), context.plugin());
    WorldPaper.circles(config, context.scheduler().mainThread())
        .ifPresent(circles ->
            context
                .plugin()
                .getServer()
                .getPluginManager()
                .registerEvents(circles, context.plugin()));
    context.services().provide(WildWorlds.class, worlds);
    if (context.plugin().getServer().getPluginManager().getPlugin("BlueMap") != null) {
      var map =
          new BlueMapBorders(
              context.plugin().getServer(),
              config.borders().stream().map(BorderOutline::of).toList());
      map.start(context.scheduler());
      borders = map;
    }
    var base = System.getenv("FLAGS_URL");
    var deployment = System.getenv("FLAGS_DEPLOYMENT");
    CrierGate rollout;
    if (base == null || base.isBlank() || deployment == null || deployment.isBlank()) {
      rollout = player -> java.util.concurrent.CompletableFuture.completedFuture(false);
    } else {
      var remote = new FlagsCrierGate(URI.create(base), deployment);
      gate = remote;
      rollout = remote;
    }
    var digest = Optional.<DailyDigestCommands>empty();
    if (config.digest().enabled()) {
      context.database().migrate(id(), WorldModule.class.getClassLoader());
      var ledger = new JooqDailyLedger(context.database());
      context
          .services()
          .require(com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry.class)
          .register(id(), ledger::reset);
      context
          .plugin()
          .getServer()
          .getPluginManager()
          .registerEvents(
              new DailyActivityListener(config.digest(), context.time(), ledger, context.logger()),
              context.plugin());
      digest =
          Optional.of(
              new DailyDigestCommands(
                  new DailyDigestCommands.Dependencies(
                      config.digest(), ledger, context.time(), context.scheduler()),
                  context.logger()));
    } else {
      context
          .services()
          .require(com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry.class)
          .stateless(id());
    }
    var crier =
        new CrierCommands(
            context.plugin().getServer(),
            config.crier(),
            new CrierCommands.Ports(rollout, context.scheduler(), context.logger()),
            digest);
    context
        .lifecycle()
        .registerEventHandler(LifecycleEvents.COMMANDS, event -> crier.register(event.registrar()));
    if (config.ambient().enabled()) {
      context
          .plugin()
          .getServer()
          .getPluginManager()
          .registerEvents(
              new AmbientBarks(context.plugin(), config.ambient(), context.time()),
              context.plugin());
    }
    if (config.merchant().enabled()) {
      MerchantGate merchantRollout;
      if (base == null || base.isBlank() || deployment == null || deployment.isBlank()) {
        merchantRollout = player -> java.util.concurrent.CompletableFuture.completedFuture(false);
      } else {
        var remote = new FlagsMerchantGate(URI.create(base), deployment);
        merchantGate = remote;
        merchantRollout = remote;
      }
      context
          .plugin()
          .getServer()
          .getPluginManager()
          .registerEvents(
              new WindmillMerchant(
                  context.plugin(),
                  config.merchant(),
                  new WindmillMerchant.Services(
                      context.time(),
                      context.logger(),
                      merchantRollout,
                      context.scheduler().mainThread())),
              context.plugin());
    }
    context.logger().info("{} module loaded {}", id(), worlds.defaultWorld().name());
  }

  @Override
  public void disable() {
    if (borders != null) {
      borders.stop();
      borders = null;
    }
    if (gate != null) {
      gate.close();
      gate = null;
    }
    if (merchantGate != null) {
      merchantGate.close();
      merchantGate = null;
    }
  }
}
