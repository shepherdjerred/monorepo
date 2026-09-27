package com.shepherdjerred.thestorm.world.adapter.paper;

import com.mojang.brigadier.Command;
import com.shepherdjerred.thestorm.world.domain.CrierConfig;
import com.shepherdjerred.thestorm.world.domain.CrierNews;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Server;
import org.bukkit.entity.Player;

/** An on-demand, main-world bulletin; registration is gated by world.yml. */
public final class CrierCommands {

  private final CrierConfig config;

  public CrierCommands(Server server, CrierConfig config) {
    if (server.getWorld(config.world()) == null) {
      throw new IllegalStateException("crier world is not loaded: " + config.world());
    }
    this.config = config;
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
    for (var line :
        CrierNews.bulletin(
            world.getFullTime(), world.getTime(), world.hasStorm(), world.isThundering())) {
      player.sendMessage(Component.text(line, NamedTextColor.GOLD));
    }
    return Command.SINGLE_SUCCESS;
  }
}
