package com.shepherdjerred.thestorm.creative.adapter.paper;

import io.papermc.paper.command.brigadier.Commands;
import org.bukkit.entity.Player;

/**
 * {@code /creative} enters the plot world and {@code /creative leave} returns the survival body.
 * Plot commands are attached beside those two.
 */
public final class CreativeCommands {

  private final CreativeSessions sessions;
  private final CreativePlots plots;

  public CreativeCommands(CreativeSessions sessions, CreativePlots plots) {
    this.sessions = sessions;
    this.plots = plots;
  }

  public void register(Commands commands) {
    var root =
        Commands.literal("creative")
            .requires(source -> source.getSender() instanceof Player)
            .executes(command -> sessions.enter((Player) command.getSource().getSender()))
            .then(
                Commands.literal("leave")
                    .executes(command -> sessions.leave((Player) command.getSource().getSender())));
    plots.attach(root);
    commands.register(root.build(), "Enter, leave, or claim a creative plot");
  }
}
