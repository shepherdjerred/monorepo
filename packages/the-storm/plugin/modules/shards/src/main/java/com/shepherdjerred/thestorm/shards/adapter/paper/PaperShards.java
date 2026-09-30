package com.shepherdjerred.thestorm.shards.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.shards.app.StormShards;
import com.shepherdjerred.thestorm.shards.domain.Altars;
import com.shepherdjerred.thestorm.shards.domain.Bonuses;
import com.shepherdjerred.thestorm.shards.domain.ShardDrops;
import com.shepherdjerred.thestorm.shards.domain.ShardsConfig;
import com.shepherdjerred.thestorm.shards.domain.Upgrades;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.List;
import org.bukkit.NamespacedKey;
import org.bukkit.event.Listener;

/** Registers shards after the configured altar chunks have been checked without blocking a tick. */
public final class PaperShards {

  private PaperShards() {}

  /**
   * Validates names immediately and registers listeners after asynchronous altar validation.
   *
   * @return the shard item port for other modules
   * @throws IllegalStateException when a material, entity type, spawn reason or world in {@code
   *     shards.yml} does not exist on this server
   */
  public static StormShards install(ModuleContext context, ShardsConfig config) {
    var plugin = context.plugin();
    var problems = PaperNames.problems(config, plugin.getServer());
    if (!problems.isEmpty()) {
      problems.forEach(problem -> context.logger().error("shards.yml: {}", problem));
      throw new IllegalStateException("Invalid shards.yml:\n" + String.join("\n", problems));
    }
    var bonuses = new Bonuses(config.bonuses());
    var upgrades = new Upgrades(config.upgrades());
    var text = new ShardText(config.messages(), config.upgrades().loreLine());
    var gear =
        new StormGear(
            new NamespacedKey(plugin, "storm_tier"),
            new NamespacedKey(plugin, "storm_gear"),
            bonuses,
            text);
    var shards = new ShardItems(new NamespacedKey(plugin, "shard"), gear, config.item());
    var kit = new ShardKit(shards, gear, text, context.random(), context.time());
    var altars = new Altars(config.altars(), config.upgrades().attemptCooldown());
    var placed = new PlacedBlocks(new NamespacedKey(plugin, "placed_sources"));

    List<Listener> listeners =
        List.of(
            new DropListener(
                new ShardDrops(config.drops()),
                placed,
                kit,
                new DropListener.ProvenanceKeys(
                    new NamespacedKey(plugin, "excluded_shard_origin"),
                    new NamespacedKey(plugin, "fresh_shard_chunk"))),
            new AltarListener(
                new AltarSetup(altars, upgrades, context.scheduler(), AltarSetup::paperSky), kit),
            new CombatListener(bonuses, gear),
            new CraftingGuard(shards));
    var _ =
        PaperNames.altarProblemsAsync(config, plugin.getServer(), context.scheduler().mainThread())
            .whenCompleteAsync(
                (altarProblems, failure) -> {
                  if (!plugin.isEnabled()) {
                    return;
                  }
                  if (failure != null) {
                    context.logger().error("Could not validate shard altars", failure);
                    plugin.getServer().shutdown();
                    return;
                  }
                  if (!altarProblems.isEmpty()) {
                    altarProblems.forEach(
                        problem -> context.logger().error("shards.yml: {}", problem));
                    plugin.getServer().shutdown();
                    return;
                  }
                  var pluginManager = plugin.getServer().getPluginManager();
                  listeners.forEach(listener -> pluginManager.registerEvents(listener, plugin));
                },
                context.scheduler().mainThread())
            .exceptionallyAsync(
                failure -> {
                  context.logger().error("Shard altar validation callback failed", failure);
                  plugin.getServer().shutdown();
                  return null;
                },
                context.scheduler().mainThread());

    var command = new ShardsCommand(kit, bonuses, upgrades);
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event ->
                event
                    .registrar()
                    .register(command.node(), "Storm Shards: help, info and admin give"));
    return shards;
  }
}
