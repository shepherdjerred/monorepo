package com.shepherdjerred.thestorm.stats;

import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.stats.adapter.db.JooqStatsStore;
import com.shepherdjerred.thestorm.stats.adapter.http.HttpStatsTransport;
import com.shepherdjerred.thestorm.stats.adapter.http.StatsEndpoint;
import com.shepherdjerred.thestorm.stats.adapter.paper.PlayerStateReader;
import com.shepherdjerred.thestorm.stats.adapter.paper.StatsCombatListener;
import com.shepherdjerred.thestorm.stats.adapter.paper.StatsCommand;
import com.shepherdjerred.thestorm.stats.adapter.paper.StatsPaperPorts;
import com.shepherdjerred.thestorm.stats.adapter.paper.StatsSampler;
import com.shepherdjerred.thestorm.stats.adapter.paper.StatsSessionListener;
import com.shepherdjerred.thestorm.stats.app.StatsConfig;
import com.shepherdjerred.thestorm.stats.app.StatsService;
import com.shepherdjerred.thestorm.stats.app.StatsTransport;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Function;
import java.util.function.Supplier;
import org.bukkit.event.HandlerList;
import org.jspecify.annotations.Nullable;

/**
 * Plan-style player and gameplay analytics module: tracks human sessions, world/mode intervals,
 * survival combat, connection bounces, and progression snapshots; serves {@code /stats} in-game;
 * and asynchronously exports durable batches to {@code storm-stats} when configured.
 */
public final class StatsModule implements StormModule {

  private static final UUID SYSTEM_ACTOR = new UUID(0L, 0L);

  private final Function<String, Optional<String>> environment;
  private @Nullable Running running;

  public StatsModule() {
    this(name -> Optional.ofNullable(System.getenv(name)));
  }

  public StatsModule(Function<String, Optional<String>> environment) {
    this.environment = environment;
  }

  @Override
  public String id() {
    return "stats";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("stats.yml", StatsConfig.class);
    var endpoint = StatsEndpoint.resolve(config, environment);

    context.database().migrate(id(), StatsModule.class.getClassLoader());
    var store = new JooqStatsStore(context.database());
    StatsTransport transport = endpoint.map(HttpStatsTransport::new).orElse(null);

    var service =
        new StatsService(
            new StatsService.Dependencies(config, store, transport, exportGate(context)),
            new StatsService.Clocks(context.time(), () -> randomUuid(context), context.logger()));

    context.services().provide(StatsService.class, service);
    context.services().require(PlayerResetRegistry.class).register(id(), service::resetPlayer);

    var _ =
        service
            .recoverInterrupted()
            .whenComplete((recovered, failure) -> {
              if (failure != null) {
                context.logger().error("Could not recover interrupted stats sessions", failure);
              } else if (recovered > 0) {
                context.logger().info("Recovered {} interrupted stats sessions", recovered);
              }
            });

    var server = context.plugin().getServer();
    var ports = StatsPaperPorts.discover(context.services());
    var stateReader = new PlayerStateReader(server, ports, context.time());
    var sampler =
        new StatsSampler(
            new StatsSampler.Context(server, service, ports, stateReader),
            context.time(),
            context.logger());
    var sessionListener = new StatsSessionListener(service, stateReader, sampler::samplePlayer);
    var combatListener = new StatsCombatListener(service, stateReader);
    server.getPluginManager().registerEvents(sessionListener, context.plugin());
    server.getPluginManager().registerEvents(combatListener, context.plugin());
    Runnable afkUnsubscribe =
        ports
            .activityFeed()
            .map(feed -> feed.observe((playerUuid, active) -> service.syncAfk(playerUuid, !active)))
            .orElse(() -> {});

    for (var online : server.getOnlinePlayers()) {
      if (Humans.isHuman(online)) {
        service.playerJoined(stateReader.joinInput(online, null));
      }
    }

    var snapshotPeriod = Duration.ofSeconds(config.snapshotIntervalSeconds());
    var samplerTask =
        context.scheduler().repeatOnMainThread(snapshotPeriod, snapshotPeriod, sampler::sample);

    Cancellable flushTask = () -> {};
    if (endpoint.isPresent()) {
      var flushPeriod = Duration.ofSeconds(config.flushIntervalSeconds());
      flushTask =
          context
              .scheduler()
              .repeatOnMainThread(
                  flushPeriod,
                  flushPeriod,
                  () -> {
                    var _ = service.flush();
                  });
      context.logger().info("Stats export enabled toward {}", endpoint.orElseThrow().ingestUri());
    } else {
      context
          .logger()
          .info(
              "Stats ingest env ({} / {}) unset; recording local summaries only",
              config.ingestUrlEnv(),
              config.ingestTokenEnv());
    }

    var command =
        new StatsCommand(
            new StatsCommand.Dependencies(server, config, store),
            context.scheduler().mainThread(),
            context.logger());
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> command.register(event.registrar()));

    running =
        new Running(
            service, sessionListener, combatListener, afkUnsubscribe, samplerTask, flushTask);
  }

  @Override
  public void disable() {
    var current = running;
    running = null;
    if (current != null) {
      current.samplerTask().cancel();
      current.flushTask().cancel();
      current.afkUnsubscribe().run();
      HandlerList.unregisterAll(current.sessionListener());
      HandlerList.unregisterAll(current.combatListener());
      current.service().close();
    }
  }

  private static Supplier<CompletableFuture<Boolean>> exportGate(ModuleContext context) {
    var gameplay = context.services().find(ManagedGameplay.class);
    if (gameplay.isEmpty()) {
      return () -> CompletableFuture.completedFuture(true);
    }
    var managed = gameplay.orElseThrow();
    return () ->
        managed.enabledOrDefault(
            ManagedGameplay.STATS_EXPORT,
            SYSTEM_ACTOR,
            true,
            failure ->
                context
                    .logger()
                    .warn(
                        "Flag provider unavailable for {}; retaining default true",
                        ManagedGameplay.STATS_EXPORT));
  }

  private static UUID randomUuid(ModuleContext context) {
    var rng = context.random();
    long msb = (rng.nextLong() & ~0xf000L) | 0x4000L;
    long lsb = (rng.nextLong() & 0x3fffffffffffffffL) | 0x8000000000000000L;
    if ((msb >>> 32) == 0L) {
      msb |= 0x0000000100000000L;
    }
    return new UUID(msb, lsb);
  }

  private record Running(
      StatsService service,
      StatsSessionListener sessionListener,
      StatsCombatListener combatListener,
      Runnable afkUnsubscribe,
      Cancellable samplerTask,
      Cancellable flushTask) {}
}
