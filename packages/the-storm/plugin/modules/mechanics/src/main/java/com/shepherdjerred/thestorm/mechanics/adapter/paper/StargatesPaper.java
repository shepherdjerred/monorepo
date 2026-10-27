package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.mechanics.adapter.db.JooqStargateStore;
import com.shepherdjerred.thestorm.mechanics.adapter.remote.FliptStargatesGate;
import com.shepherdjerred.thestorm.mechanics.app.StargateAccess;
import com.shepherdjerred.thestorm.mechanics.app.StargateBook;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateConfig;
import com.shepherdjerred.thestorm.towns.app.TownMembership;
import com.shepherdjerred.thestorm.tracks.app.TrackLevels;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.concurrent.atomic.AtomicBoolean;
import org.jspecify.annotations.Nullable;

/** Installs the gate listeners and fails closed until storage and rollout are ready. */
public final class StargatesPaper {
  private final StargatePortals portals;
  private final StargateServerHub serverHub;
  private final @Nullable FliptStargatesGate rollout;
  private final AtomicBoolean enabled;

  private StargatesPaper(
      StargatePortals portals,
      StargateServerHub serverHub,
      @Nullable FliptStargatesGate rollout,
      AtomicBoolean enabled) {
    this.portals = portals;
    this.serverHub = serverHub;
    this.rollout = rollout;
    this.enabled = enabled;
  }

  public static StargatesPaper start(
      ModuleContext context, StargateConfig config, @Nullable FliptStargatesGate rollout) {
    var enabled = new AtomicBoolean(false);
    var book =
        new StargateBook(
            new JooqStargateStore(context.database()), context.scheduler().mainThread());
    var access =
        new StargateAccess(
            context.services().require(TrackLevels.class),
            context.services().require(TownMembership.class));
    var settings = new StargateSettings(config.openFor(), enabled::get);
    var portals = new StargatePortals(context, book, access, settings);
    context
        .services()
        .require(com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry.class)
        .register("stargates", portals::resetPlayer);
    var serverHub = new StargateServerHub(context, book, settings, config.serverGates());
    var events = context.plugin().getServer().getPluginManager();
    events.registerEvents(new StargateProtection(book), context.plugin());
    events.registerEvents(
        new StargateCreation(context, book, access, enabled::get), context.plugin());
    events.registerEvents(portals, context.plugin());
    events.registerEvents(serverHub, context.plugin());
    var commands = new StargateCommands(context, book, access, portals);
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> commands.register(event.registrar()));
    var _ =
        book.load()
            .whenCompleteAsync(
                (ignored, failure) -> {
                  if (!context.plugin().isEnabled()) return;
                  if (failure != null)
                    context
                        .logger()
                        .error("Stargates remain guarded: storage could not load", failure);
                  else {
                    portals.reconcileLoaded();
                    serverHub.reconcileLoaded();
                  }
                },
                context.scheduler().mainThread());

    if (rollout == null) {
      context.logger().info("Stargates are disabled: no Flipt evaluation configuration");
    } else {
      var _ =
          rollout
              .enabled()
              .whenCompleteAsync(
                  (value, failure) -> {
                    if (!context.plugin().isEnabled()) return;
                    if (failure != null)
                      context
                          .logger()
                          .error("Stargates remain disabled: rollout evaluation failed", failure);
                    else enabled.set(Boolean.TRUE.equals(value));
                  },
                  context.scheduler().mainThread());
    }
    return new StargatesPaper(portals, serverHub, rollout, enabled);
  }

  public void stop() {
    enabled.set(false);
    portals.stop();
    serverHub.stop();
    if (rollout != null) rollout.close();
  }
}
