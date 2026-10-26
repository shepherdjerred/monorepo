package com.shepherdjerred.thestorm.creative;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.snapshot.SavedPlayerData;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.creative.adapter.bluemap.BlueMapPlots;
import com.shepherdjerred.thestorm.creative.adapter.db.JooqBodyStore;
import com.shepherdjerred.thestorm.creative.adapter.db.JooqClaimStore;
import com.shepherdjerred.thestorm.creative.adapter.export.SchematicFiles;
import com.shepherdjerred.thestorm.creative.adapter.grim.CreativeAnticheat;
import com.shepherdjerred.thestorm.creative.adapter.paper.CreativeAudit;
import com.shepherdjerred.thestorm.creative.adapter.paper.CreativeCommands;
import com.shepherdjerred.thestorm.creative.adapter.paper.CreativeGenerator;
import com.shepherdjerred.thestorm.creative.adapter.paper.CreativeGuard;
import com.shepherdjerred.thestorm.creative.adapter.paper.CreativePlots;
import com.shepherdjerred.thestorm.creative.adapter.paper.CreativeSessions;
import com.shepherdjerred.thestorm.creative.adapter.paper.CreativeWorld;
import com.shepherdjerred.thestorm.creative.adapter.paper.PlotGuard;
import com.shepherdjerred.thestorm.creative.adapter.worldedit.CreativeEdits;
import com.shepherdjerred.thestorm.creative.app.ClaimBook;
import com.shepherdjerred.thestorm.creative.domain.CreativeConfig;
import com.shepherdjerred.thestorm.creative.domain.PlotMarkers;
import com.shepherdjerred.thestorm.creative.domain.StoredClaim;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.io.File;
import java.util.List;
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
    var config = context.loadConfig("creative.yml", CreativeConfig.class);
    worldConfig = config;
    worldName = config.world();
    var world = context.plugin().getServer().getWorld(config.world());
    if (world == null) {
      throw new IllegalStateException("Creative world is not loaded: " + config.world());
    }
    if (!(world.getGenerator() instanceof CreativeGenerator)) {
      var generator = world.getGenerator();
      throw new IllegalStateException(
          "Creative world "
              + config.world()
              + " is not using TheStorm's plot generator ("
              + (generator == null ? "no generator" : generator.getClass().getName())
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
    context.services().require(SealedWorlds.class).seal(world);
    CreativeWorld.apply(world, config);
    var book = new ClaimBook(config.catalog());
    claims = book;
    var store = new JooqClaimStore(context.database());
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
                        new File(context.plugin().getDataFolder(), "creative-schematics")))));
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
    var _ = loaded;
    context
        .logger()
        .info(
            "Sealed creative plots in {} with CoreProtect history and plot protection",
            world.getName());
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

  private void redraw() {
    var plots = map;
    var book = claims;
    var config = worldConfig;
    if (plots == null || book == null || config == null) {
      return;
    }
    plots.draw(PlotMarkers.select(worldName, config, book.marked()));
  }

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
