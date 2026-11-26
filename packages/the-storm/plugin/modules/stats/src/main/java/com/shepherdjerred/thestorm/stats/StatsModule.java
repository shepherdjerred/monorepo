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
import com.shepherdjerred.thestorm.stats.domain.GeoIpDatabase;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.time.Duration;
import java.util.Objects;
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
  private final Supplier<GeoIpDatabase> geoIpSupplier;
  private @Nullable StatsService activeService;
  private @Nullable Running running;

  public StatsModule() {
    this(name -> Optional.ofNullable(System.getenv(name)), GeoIpDatabase::bundled);
  }

  public StatsModule(Function<String, Optional<String>> environment) {
    this(environment, GeoIpDatabase::bundled);
  }

  public StatsModule(
      Function<String, Optional<String>> environment, Supplier<GeoIpDatabase> geoIpSupplier) {
    this.environment = Objects.requireNonNull(environment, "environment");
    this.geoIpSupplier = Objects.requireNonNull(geoIpSupplier, "geoIpSupplier");
  }

  @Override
  public String id() {
    return "stats";
  }

  public boolean ready() {
    return running != null;
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
    activeService = service;

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
    var command =
        new StatsCommand(
            new StatsCommand.Dependencies(server, config, store),
            context.scheduler().mainThread(),
            context.logger());
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> command.register(event.registrar()));

    var bootstrap = new Bootstrap(context, config, endpoint, service);
    var _ =
        context
            .compute()
            .submit(geoIpSupplier)
            .whenCompleteAsync(
                (geoIp, failure) -> completePaperStartup(bootstrap, geoIp, failure),
                context.scheduler().mainThread());
  }

  @Override
  public void disable() {
    var current = running;
    running = null;
    var service = activeService;
    activeService = null;
    if (current != null) {
      current.samplerTask().cancel();
      current.flushTask().cancel();
      current.afkUnsubscribe().run();
      HandlerList.unregisterAll(current.sessionListener());
      HandlerList.unregisterAll(current.combatListener());
    }
    if (service != null) {
      service.close();
    }
  }

  private void completePaperStartup(
      Bootstrap bootstrap, @Nullable GeoIpDatabase geoIp, @Nullable Throwable failure) {
    if (activeService != bootstrap.service()) {
      return;
    }
    var context = bootstrap.context();
    if (failure != null || geoIp == null) {
      context
          .logger()
          .error(
              "Stats module failed to load bundled GeoIP database; stopping the server", failure);
      disable();
      context.plugin().getServer().shutdown();
      return;
    }
    running = installPaperRuntime(bootstrap, geoIp);
  }

  private static Running installPaperRuntime(Bootstrap bootstrap, GeoIpDatabase geoIp) {
    var context = bootstrap.context();
    var config = bootstrap.config();
    var service = bootstrap.service();
    var server = context.plugin().getServer();
    var ports = StatsPaperPorts.discover(context.services());
    var stateReader = new PlayerStateReader(server, ports, context.time(), geoIp);
    var sampler =
        new StatsSampler(
            new StatsSampler.Context(server, service, ports, stateReader),
            context.time(),
            context.logger());
    var sessionListener =
        new StatsSessionListener(service, stateReader, sampler::prepareQuitSnapshot);
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
    var flushTask = scheduleFlushTask(bootstrap);
    return new Running(sessionListener, combatListener, afkUnsubscribe, samplerTask, flushTask);
  }

  private static Cancellable scheduleFlushTask(Bootstrap bootstrap) {
    var context = bootstrap.context();
    var config = bootstrap.config();
    if (bootstrap.endpoint().isEmpty()) {
      context
          .logger()
          .info(
              "Stats ingest env ({} / {}) unset; recording local summaries only",
              config.ingestUrlEnv(),
              config.ingestTokenEnv());
      return () -> {};
    }
    var flushPeriod = Duration.ofSeconds(config.flushIntervalSeconds());
    var task =
        context
            .scheduler()
            .repeatOnMainThread(
                flushPeriod,
                flushPeriod,
                () -> {
                  var _ = bootstrap.service().flush();
                });
    context
        .logger()
        .info("Stats export enabled toward {}", bootstrap.endpoint().orElseThrow().ingestUri());
    return task;
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

  private record Bootstrap(
      ModuleContext context,
      StatsConfig config,
      Optional<StatsEndpoint> endpoint,
      StatsService service) {}

  private record Running(
      StatsSessionListener sessionListener,
      StatsCombatListener combatListener,
      Runnable afkUnsubscribe,
      Cancellable samplerTask,
      Cancellable flushTask) {}
}
