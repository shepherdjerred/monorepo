package com.shepherdjerred.thestorm.creative.adapter.paper;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import io.papermc.paper.command.brigadier.Commands;
import net.kyori.adventure.text.Component;
import org.bukkit.command.CommandSender;
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
            .executes(command -> enter(command.getSource().getSender()))
            .then(
                Commands.literal("leave")
                    .requires(source -> source.getSender() instanceof Player)
                    .executes(command -> sessions.leave((Player) command.getSource().getSender())));
    plots.attach(root);
    commands.register(root.build(), "Enter, leave, or claim a creative plot");
  }

  private int enter(CommandSender sender) {
    if (!(sender instanceof Player player)) {
      sender.sendMessage(
          HouseStyle.error("Creative", Component.text("That command needs a player.")));
      return 0;
    }
    return sessions.enter(player);
  }
}
