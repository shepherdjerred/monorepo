package com.shepherdjerred.thestorm.world.adapter.paper;

import com.mojang.brigadier.Command;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.world.domain.CrierConfig;
import com.shepherdjerred.thestorm.world.domain.CrierNews;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Server;
import org.bukkit.entity.Player;

/** An on-demand, main-world bulletin gated per player by the managed rollout. */
public final class CrierCommands {

  private final CrierConfig config;
  private final CrierGate gate;
  private final Scheduler scheduler;
  private final ComponentLogger logger;

  /** Runtime ports used after a command is invoked. */
  public record Ports(CrierGate gate, Scheduler scheduler, ComponentLogger logger) {}

  public CrierCommands(Server server, CrierConfig config, Ports ports) {
    if (server.getWorld(config.world()) == null) {
      throw new IllegalStateException("crier world is not loaded: " + config.world());
    }
    this.config = config;
    this.gate = ports.gate();
    this.scheduler = ports.scheduler();
    this.logger = ports.logger();
  }

  public void register(Commands commands) {
    commands.register(
        Commands.literal("crier").executes(context -> announce(context.getSource())).build(),
        "Hear the main-world town crier");
  }

  private int announce(CommandSourceStack source) {
    if (!(source.getSender() instanceof Player player)) {
      source.getSender().sendMessage("The crier can only be heard in the main world.");
      return Command.SINGLE_SUCCESS;
    }
    var world = player.getWorld();
    if (!world.getName().equals(config.world())) {
      player.sendMessage(
          Component.text("Visit the main world to hear the crier.", NamedTextColor.GRAY));
      return Command.SINGLE_SUCCESS;
    }
    if (!config.enabled()) {
      player.sendMessage(Component.text("The crier is not available yet.", NamedTextColor.GRAY));
      return Command.SINGLE_SUCCESS;
    }
    var _ =
        gate.enabled(player.getUniqueId())
            .whenCompleteAsync(
                (enabled, failure) -> {
                  if (failure != null) {
                    logger.error("Could not evaluate crier flag", failure);
                  }
                  if (failure != null || !Boolean.TRUE.equals(enabled)) {
                    if (player.isOnline()) {
                      player.sendMessage(
                          Component.text(
                              "The crier is not available right now.", NamedTextColor.GRAY));
                    }
                    return;
                  }
                  if (player.isOnline() && player.getWorld().getName().equals(config.world())) {
                    bulletin(player);
                  }
                },
                scheduler.mainThread());
    return Command.SINGLE_SUCCESS;
  }

  private void bulletin(Player player) {
    var world = player.getWorld();
    for (var line :
        CrierNews.bulletin(
            world.getFullTime(), world.getTime(), world.hasStorm(), world.isThundering())) {
      player.sendMessage(Component.text(line, NamedTextColor.GOLD));
    }
  }
}
