package com.shepherdjerred.thestorm.rwfbots;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.rwfbots.adapter.citizens.CitizensBodies;
import com.shepherdjerred.thestorm.rwfbots.adapter.content.NavFiles;
import com.shepherdjerred.thestorm.rwfbots.adapter.content.PersonalityFiles;
import com.shepherdjerred.thestorm.rwfbots.adapter.content.RwfBotsConfig;
import com.shepherdjerred.thestorm.rwfbots.adapter.db.JooqPersonalityStatsStore;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.Bodies;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.RwfBotsPaper;
import com.shepherdjerred.thestorm.rwfbots.app.NavCatalog;
import com.shepherdjerred.thestorm.rwfbots.app.StatsCache;
import java.util.Optional;
import java.util.function.Function;
import java.util.function.Supplier;
import org.bukkit.World;
import org.jspecify.annotations.Nullable;

/**
 * Bot combatants for Red Warfare Search and Destroy. Requires Citizens for the bodies and the rwf
 * module for the match; loads {@code rwfbots.yml}, the personalities and every map's nav artifact,
 * migrates its table, reads the personality records back, then wires the Paper side and provides
 * the {@code BotRoster} rwf fills matches from.
 */
public final class RwfBotsModule implements StormModule {

  /** The file this module reads from the plugin data folder. */
  public static final String CONFIG = "rwfbots.yml";

  /**
   * What tests replace.
   *
   * @param bodies makes the bodies; empty means Citizens, which must then be loaded
   * @param world the match world; empty means the world rwf runs in, read from rwf.yml
   * @param tickTimes the server's recent tick times; empty means the real server's
   */
  public record Hooks(
      Optional<Function<ModuleContext, Bodies>> bodies,
      Optional<World> world,
      Optional<Supplier<long[]>> tickTimes) {

    public static Hooks production() {
      return new Hooks(Optional.empty(), Optional.empty(), Optional.empty());
    }
  }

  private final Hooks hooks;
  private @Nullable RwfBotsPaper paper;

  public RwfBotsModule() {
    this(Hooks.production());
  }

  public RwfBotsModule(Hooks hooks) {
    this.hooks = hooks;
  }

  @Override
  public String id() {
    return "rwfbots";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig(CONFIG, RwfBotsConfig.class);
    var personalities = PersonalityFiles.load(context.dataDirectory());
    var nav = new NavCatalog();
    var loaded = NavFiles.load(context.dataDirectory());
    loaded.artifacts().values().forEach(nav::add);
    loaded
        .problems()
        .forEach(
            (mapId, problem) -> {
              nav.reject(mapId, problem);
              context.logger().error("rwfbots: map {} runs humans-only: {}", mapId, problem);
            });
    context.database().migrate(id(), getClass().getClassLoader());
    var store = new JooqPersonalityStatsStore(context.database());
    var stats = new StatsCache();
    var _ =
        store
            .loadAll()
            .whenCompleteAsync(
                (records, failure) -> {
                  if (failure != null) {
                    context.logger().error("rwfbots: could not read personality records", failure);
                  } else {
                    stats.load(records);
                    context.logger().info("rwfbots: {} personality records loaded", records.size());
                  }
                },
                context.scheduler().mainThread());
    var bodies = hooks.bodies().map(make -> make.apply(context)).orElseGet(() -> citizens(context));
    var world = hooks.world().orElseGet(() -> rwfWorld(context));
    paper =
        RwfBotsPaper.start(
            context,
            new RwfBotsPaper.App(
                config,
                personalities,
                nav,
                stats,
                store,
                bodies,
                world,
                hooks.tickTimes().orElseGet(() -> context.plugin().getServer()::getTickTimes)));
    context
        .logger()
        .info(
            "rwfbots: {} personalities, {} maps with nav artifacts, traces {}",
            personalities.active().size(),
            loaded.artifacts().size(),
            config.traces().enabled() ? "on" : "off");
  }

  private static Bodies citizens(ModuleContext context) {
    var plugin = context.plugin().getServer().getPluginManager().getPlugin("Citizens");
    if (plugin == null || !plugin.isEnabled()) {
      throw new IllegalStateException(
          "rwfbots needs the Citizens plugin for bot bodies; install it (server/plugins.json) or"
              + " disable rwfbots in config.yml");
    }
    return CitizensBodies.open(context.plugin(), uuid -> {});
  }

  /** The world rwf runs in, as its config names it. */
  private static World rwfWorld(ModuleContext context) {
    var config = context.loadConfig("rwf.yml", RwfWorldName.class);
    var world = context.plugin().getServer().getWorld(config.world());
    if (world == null) {
      throw new IllegalStateException(
          "rwf.yml names world " + config.world() + ", which is not loaded");
    }
    return world;
  }

  /** The Paper side while enabled, for tests. */
  Optional<RwfBotsPaper> paper() {
    return Optional.ofNullable(paper);
  }

  @Override
  public void disable() {
    var current = paper;
    if (current != null) {
      current.stop();
      paper = null;
    }
  }
}
