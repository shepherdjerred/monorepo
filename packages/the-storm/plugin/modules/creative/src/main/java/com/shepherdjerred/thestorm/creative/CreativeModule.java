package com.shepherdjerred.thestorm.creative;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.players.KnownPlayer;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.core.snapshot.SavedPlayerData;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.creative.adapter.bluemap.BlueMapPlots;
import com.shepherdjerred.thestorm.creative.adapter.bundle.BundledTemplate;
import com.shepherdjerred.thestorm.creative.adapter.db.JooqBodyStore;
import com.shepherdjerred.thestorm.creative.adapter.db.JooqClaimStore;
import com.shepherdjerred.thestorm.creative.adapter.db.JooqReviewStore;
import com.shepherdjerred.thestorm.creative.adapter.export.SchematicFiles;
import com.shepherdjerred.thestorm.creative.adapter.grim.CreativeAnticheat;
import com.shepherdjerred.thestorm.creative.adapter.paper.CreativeAudit;
import com.shepherdjerred.thestorm.creative.adapter.paper.CreativeBodies;
import com.shepherdjerred.thestorm.creative.adapter.paper.CreativeCommands;
import com.shepherdjerred.thestorm.creative.adapter.paper.CreativeGenerator;
import com.shepherdjerred.thestorm.creative.adapter.paper.CreativeGuard;
import com.shepherdjerred.thestorm.creative.adapter.paper.CreativePlots;
import com.shepherdjerred.thestorm.creative.adapter.paper.CreativeSessions;
import com.shepherdjerred.thestorm.creative.adapter.paper.CreativeWorld;
import com.shepherdjerred.thestorm.creative.adapter.paper.PlotGuard;
import com.shepherdjerred.thestorm.creative.adapter.worldedit.CreativeEdits;
import com.shepherdjerred.thestorm.creative.adapter.worldedit.PlotSchematics;
import com.shepherdjerred.thestorm.creative.app.ClaimBook;
import com.shepherdjerred.thestorm.creative.app.CreativeEntry;
import com.shepherdjerred.thestorm.creative.app.ReviewBook;
import com.shepherdjerred.thestorm.creative.app.ReviewStore.Snapshot;
import com.shepherdjerred.thestorm.creative.domain.CreativeConfig;
import com.shepherdjerred.thestorm.creative.domain.PlotFootprint;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.PlotMarkers;
import com.shepherdjerred.thestorm.creative.domain.PlotTemplate;
import com.shepherdjerred.thestorm.creative.domain.PlotView;
import com.shepherdjerred.thestorm.creative.domain.StoredClaim;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.plugin.Plugin;
import org.jspecify.annotations.Nullable;

/**
 * The recovered creative plot world. Entering it swaps to an empty creative body and leaving
 * restores the survival body exactly. It refuses to enable unless the world is already loaded with
 * this plugin's plot generator and CoreProtect is recording block, sign, bucket, entity, and
 * WorldEdit changes there. A player can change a plot only when they own it. Roads and staff-held
 * plots stay closed. A player claims through {@code /creative}; the historical catalog is never
 * written.
 */
public final class CreativeModule implements StormModule {

  private @Nullable CreativeSessions sessions;
  private @Nullable ClaimBook claims;
  private @Nullable BlueMapPlots map;
  private @Nullable CreativeEdits edits;
  private @Nullable CreativeAnticheat anticheat;
  private @Nullable Plugin plugin;
  private @Nullable ComponentLogger logger;
  private @Nullable PlayerDirectory players;
  private @Nullable Scheduler scheduler;
  private int mapGeneration;
  private String worldName = "creative";
  private @Nullable CreativeConfig worldConfig;

  @Override
  public String id() {
    return "creative";
  }

  @Override
  public void enable(ModuleContext context) {
    plugin = context.plugin();
    logger = context.logger();
    players = context.services().require(PlayerDirectory.class);
    scheduler = context.scheduler();
    var config = context.loadConfig("creative.yml", CreativeConfig.class);
    var emptyPlot =
        context
            .compute()
            .submit(() -> BundledTemplate.read(config.grid(), "/creative-empty-plot.bin"));
    worldConfig = config;
    worldName = config.world();
    var world = context.plugin().getServer().getWorld(config.world());
    if (world == null) {
      throw new IllegalStateException("Creative world is not loaded: " + config.world());
    }
    if (!(world.getGenerator() instanceof CreativeGenerator generator)) {
      var installed = world.getGenerator();
      throw new IllegalStateException(
          "Creative world "
              + config.world()
              + " is not using TheStorm's plot generator ("
              + (installed == null ? "no generator" : installed.getClass().getName())
              + ")");
    }
    CreativeAudit.require(context.plugin(), world);
    context.database().migrate(id(), CreativeModule.class.getClassLoader());
    var visits =
        new CreativeSessions(
            new CreativeSessions.Parts(
                context,
                new JooqBodyStore(context.database()),
                world,
                context.services().require(SavedPlayerData.class)));
    sessions = visits;
    context
        .services()
        .provide(
            CreativeEntry.class,
            new CreativeEntry() {
              @Override
              public void enter(org.bukkit.entity.Player player) {
                visits.enter(player);
              }

              @Override
              public org.bukkit.Location destination() {
                return CreativeBodies.spawn(world);
              }
            });
    context.services().require(SealedWorlds.class).seal(world);
    CreativeWorld.apply(world, config);
    var book = new ClaimBook(config.catalog());
    claims = book;
    var store = new JooqClaimStore(context.database());
    var reviews = new ReviewBook();
    var reviewStore = new JooqReviewStore(context.database());
    var reset =
        new com.shepherdjerred.thestorm.creative.adapter.db.JooqPlayerReset(context.database());
    context
        .services()
        .require(com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry.class)
        .register(
            id(),
            player ->
                reset
                    .reset(player)
                    .thenCompose(ignored -> store.loadAll())
                    .thenAcceptAsync(book::replace, context.scheduler().mainThread())
                    .thenCompose(ignored -> reviewStore.load())
                    .thenAcceptAsync(
                        snapshot -> reviews.replace(snapshot.ratings(), snapshot.comments()),
                        context.scheduler().mainThread())
                    .thenRunAsync(this::redraw, context.scheduler().mainThread()));
    PlotFootprint.States template = generator.template()::stateAt;
    context
        .plugin()
        .getServer()
        .getPluginManager()
        .registerEvents(new CreativeGuard(visits, world.getName()), context.plugin());
    context
        .plugin()
        .getServer()
        .getPluginManager()
        .registerEvents(
            new PlotGuard(world.getName(), config.grid(), book, config.entityCap()),
            context.plugin());
    installMap(context, world);
    installEdits(context, world, book, config);
    installAnticheat(context, world.getName());
    var commands =
        new CreativeCommands(
            visits,
            new CreativePlots(
                new CreativePlots.Parts(
                    context,
                    book,
                    store,
                    config,
                    world,
                    this::redraw,
                    new SchematicFiles(
                        context.database(),
                        new File(context.plugin().getDataFolder(), "creative-schematics")),
                    template,
                    reviews,
                    reviewStore,
                    empty(emptyPlot),
                    PlotSchematics.columns())));
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> commands.register(event.registrar()));
    visits.recoverOnline();
    var loaded =
        store
            .loadAll()
            .whenCompleteAsync(
                (rows, failure) -> loaded(rows, failure), context.scheduler().mainThread());
    var reviewed =
        reviewStore
            .load()
            .whenCompleteAsync(
                (snapshot, failure) -> reviewed(reviews, snapshot, failure),
                context.scheduler().mainThread());
    var _ = loaded;
    var _ = reviewed;
    context
        .logger()
        .info(
            "Sealed creative plots in {} with CoreProtect history and plot protection",
            world.getName());
  }

  private static PlotTemplate empty(CompletableFuture<PlotTemplate> loading) {
    try {
      return loading.join();
    } catch (CompletionException failure) {
      var cause = failure.getCause();
      throw new IllegalStateException(
          "creative empty plot was not read", cause == null ? failure : cause);
    }
  }

  private void loaded(List<StoredClaim> rows, @Nullable Throwable failure) {
    var book = claims;
    var log = logger;
    if (book == null || log == null) {
      return;
    }
    if (failure != null || rows == null) {
      log.error("Creative claims did not load", failure);
      return;
    }
    book.replace(rows);
    redraw();
  }

  private void reviewed(
      ReviewBook reviews, @Nullable Snapshot snapshot, @Nullable Throwable failure) {
    var log = logger;
    if (log == null) {
      return;
    }
    if (failure != null || snapshot == null) {
      log.error("Creative ratings did not load", failure);
      return;
    }
    reviews.replace(snapshot.ratings(), snapshot.comments());
  }

  private void redraw() {
    var plots = map;
    var book = claims;
    var directory = players;
    var hop = scheduler;
    var owner = plugin;
    if (plots == null || book == null || directory == null || hop == null || owner == null) {
      return;
    }
    var generation = ++mapGeneration;
    var marked = book.marked();
    var signed = PlotMarkers.signedNames(book.catalog().plots());
    var known = new HashMap<UUID, String>();
    var offline = new LinkedHashSet<UUID>();
    var server = owner.getServer();
    for (var view : marked) {
      if (!view.name().isBlank() || view.owner().isEmpty()) {
        continue;
      }
      var id = view.owner().orElseThrow();
      var online = server.getPlayer(id);
      if (online != null) {
        known.put(id, online.getName());
      } else {
        offline.add(id);
      }
    }
    if (offline.isEmpty()) {
      draw(plots, marked, signed, known);
      return;
    }
    var lookups = new ArrayList<CompletableFuture<Optional<KnownPlayer>>>();
    for (var id : offline) {
      lookups.add(directory.byId(id));
    }
    var resolved =
        CompletableFuture.allOf(lookups.toArray(CompletableFuture[]::new))
            .whenCompleteAsync(
                (done, failure) ->
                    resolved(
                        new MapDraw(generation, plots, signed, Map.copyOf(known), lookups),
                        failure),
                hop.mainThread());
    var _ = resolved;
  }

  private void resolved(MapDraw pending, @Nullable Throwable failure) {
    if (pending.generation() != mapGeneration) {
      return;
    }
    var book = claims;
    if (book == null) {
      return;
    }
    var known = new HashMap<>(pending.online());
    if (failure != null) {
      var log = logger;
      if (log != null) {
        log.error("Creative map could not resolve plot owners", failure);
      }
    } else {
      for (var lookup : pending.lookups()) {
        lookup.resultNow().ifPresent(player -> known.put(player.uuid(), player.lastName()));
      }
    }
    draw(pending.plots(), book.marked(), pending.signed(), known);
  }

  private void draw(
      BlueMapPlots plots,
      List<PlotView> marked,
      Map<PlotId, String> signed,
      Map<UUID, String> known) {
    var config = worldConfig;
    if (config == null) {
      return;
    }
    var captioned = PlotMarkers.presented(marked, PlotMarkers.usernames(marked, signed, known));
    plots.draw(PlotMarkers.select(worldName, config, captioned));
  }

  /** One in-flight name lookup. A newer redraw drops it. */
  private record MapDraw(
      int generation,
      BlueMapPlots plots,
      Map<PlotId, String> signed,
      Map<UUID, String> online,
      List<CompletableFuture<Optional<KnownPlayer>>> lookups) {}

  private void installMap(ModuleContext context, org.bukkit.World world) {
    if (context.plugin().getServer().getPluginManager().getPlugin("BlueMap") == null) {
      return;
    }
    var plots = new BlueMapPlots(world);
    plots.start(context.scheduler(), this::redraw);
    map = plots;
  }

  private void installEdits(
      ModuleContext context, org.bukkit.World world, ClaimBook book, CreativeConfig config) {
    if (context.plugin().getServer().getPluginManager().getPlugin("WorldEdit") == null) {
      return;
    }
    var guard =
        new CreativeEdits(
            new CreativeEdits.Parts(
                book, config.grid(), world.getName(), config.brushRadius(), context.scheduler()));
    guard.register(context.plugin());
    edits = guard;
  }

  private void installAnticheat(ModuleContext context, String creativeWorld) {
    if (context.plugin().getServer().getPluginManager().getPlugin("GrimAC") == null) {
      return;
    }
    var guard = new CreativeAnticheat(creativeWorld, context.scheduler(), context.logger());
    context.plugin().getServer().getPluginManager().registerEvents(guard, context.plugin());
    guard.refreshOnline(context.plugin().getServer().getOnlinePlayers());
    anticheat = guard;
  }

  @Override
  public void disable() {
    mapGeneration++;
    if (sessions != null) {
      sessions.shutdown();
    }
    if (edits != null) {
      edits.unregister();
    }
    if (map != null) {
      map.stop();
    }
    var guard = anticheat;
    var owner = plugin;
    if (guard != null && owner != null) {
      guard.restoreOnline(owner.getServer().getOnlinePlayers());
    }
  }
}
