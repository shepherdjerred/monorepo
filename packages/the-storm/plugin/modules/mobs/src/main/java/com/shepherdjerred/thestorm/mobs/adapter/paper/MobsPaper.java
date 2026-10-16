package com.shepherdjerred.thestorm.mobs.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.mobs.adapter.db.JooqBeginnerTimeStore;
import com.shepherdjerred.thestorm.mobs.app.BeginnerStatus;
import com.shepherdjerred.thestorm.mobs.app.MobLevels;
import com.shepherdjerred.thestorm.mobs.domain.config.MobsConfig;
import com.shepherdjerred.thestorm.mobs.domain.level.LevelCalculator;
import com.shepherdjerred.thestorm.mobs.domain.spawn.SpawnPolicy;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.BiConsumer;
import java.util.function.Supplier;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.CreatureSpawnEvent;

/** Wires the mobs module into Paper. */
public final class MobsPaper {

  record Hooks(ExtraLoot loot, BiConsumer<LivingEntity, Runnable> namedMobPersistence) {}

  private final List<Listener> listeners;
  private final LevelApplier levels;
  private final BeginnerProtection beginner;
  private final BeginnerLuckListener beginnerListener;

  private MobsPaper(
      List<Listener> listeners,
      LevelApplier levels,
      BeginnerProtection beginner,
      BeginnerLuckListener beginnerListener) {
    this.listeners = List.copyOf(listeners);
    this.levels = levels;
    this.beginner = beginner;
    this.beginnerListener = beginnerListener;
  }

  /**
   * Checks {@code config} against the running server and registers the listeners. Throws if the
   * config names an unknown mob type, spawn reason or unloaded world. Protection is only looked up
   * when admin regions are configured.
   */
  public static MobsPaper start(
      ModuleContext context, MobsConfig config, Supplier<Protection> protection) {
    return start(context, config, protection, ExtraLoot.lootTables(context.random()));
  }

  /**
   * {@link #start(ModuleContext, MobsConfig, Supplier)} with extra drops rolled by {@code loot}.
   */
  static MobsPaper start(
      ModuleContext context, MobsConfig config, Supplier<Protection> protection, ExtraLoot loot) {
    return start(context, config, protection, new Hooks(loot, LevelApplier::preserveDespawn));
  }

  static MobsPaper start(
      ModuleContext context, MobsConfig config, Supplier<Protection> protection, Hooks hooks) {
    requireKnownNames(config);
    var server = context.plugin().getServer();
    var sealed = context.services().require(SealedWorlds.class);
    var regions =
        config.adminRegions().anchors().isEmpty()
            ? AdminRegionIndex.none(context.logger())
            : AdminRegionIndex.of(
                server, config.adminRegions(), protection.get(), context.logger());
    var levels =
        new LevelApplier(
            config.scaling(),
            config.levels().cap(),
            config.nameplate(),
            hooks.namedMobPersistence());
    var rules =
        new SpawnListener.Rules(
            new SpawnPolicy(config.exclusions(), config.adminRegions().policy()),
            new LevelCalculator(config.levels()),
            sealed);
    var beginner =
        new BeginnerProtection(
            context, config.beginnerLuck(), new JooqBeginnerTimeStore(context.database()));
    var beginnerListener = new BeginnerLuckListener(context, config, levels, beginner);
    beginner.observeChanges(
        id -> {
          var player = server.getPlayer(id);
          if (player != null) beginnerListener.nearby(player.getLocation());
        });
    List<Listener> listeners =
        List.of(
            new SpawnListener(rules, levels, regions, context.random()),
            new StrengthListener(levels, hooks.loot(), context.random(), sealed),
            beginnerListener);
    listeners.forEach(
        listener -> server.getPluginManager().registerEvents(listener, context.plugin()));
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> BeginnerCommands.register(context, beginner, event.registrar()));
    beginnerListener.refreshLoaded();
    beginner.start();
    return new MobsPaper(listeners, levels, beginner, beginnerListener);
  }

  /** The port other modules use. */
  public MobLevels levels() {
    return levels;
  }

  public void stop() {
    beginner.stop();
    beginnerListener.refreshLoaded();
    listeners.forEach(HandlerList::unregisterAll);
  }

  public BeginnerStatus beginnerStatus() {
    return beginner;
  }

  private static void requireKnownNames(MobsConfig config) {
    var types = new HashSet<String>();
    for (var type : EntityType.values()) {
      if (type != EntityType.UNKNOWN) {
        types.add(type.key().value());
      }
    }
    var reasons = new HashSet<String>();
    Arrays.stream(CreatureSpawnEvent.SpawnReason.values()).forEach(r -> reasons.add(r.name()));
    requireKnown("mob type", config.exclusions().types(), types);
    requireKnown("mob type", config.scaling().byType().keySet(), types);
    requireKnown("spawn reason", config.exclusions().levelledReasons(), reasons);
  }

  private static void requireKnown(String what, Set<String> named, Set<String> known) {
    var unknown = new TreeSet<>(named);
    unknown.removeAll(known);
    if (!unknown.isEmpty()) {
      throw new IllegalStateException("mobs.yml names unknown " + what + "s: " + unknown);
    }
  }
}
