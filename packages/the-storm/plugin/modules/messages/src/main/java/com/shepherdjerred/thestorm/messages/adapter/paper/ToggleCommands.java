package com.shepherdjerred.thestorm.messages.adapter.paper;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.messages.domain.Channel;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.entity.Player;

/** {@code /toggle-tips} and {@code /toggle-ads}: mute or unmute an announcement channel. */
public final class ToggleCommands {

  private final PreferenceStore preferences;

  public ToggleCommands(PreferenceStore preferences) {
    this.preferences = preferences;
  }

  /** Registers both commands. */
  public void register(Commands registrar) {
    registrar.register(node("toggle-tips", Channel.TIPS, "Tips"), "Turn tips on or off");
    registrar.register(node("toggle-ads", Channel.ADS, "Ads"), "Turn ads on or off");
  }

  private LiteralCommandNode<CommandSourceStack> node(String name, Channel channel, String label) {
    return Commands.literal(name)
        .requires(source -> source.getSender() instanceof Player)
        .executes(
            context -> {
              if (context.getSource().getSender() instanceof Player player) {
                var hears = preferences.toggle(player, channel).hears(channel);
                player.sendMessage(HouseStyle.info(label, state(label, hears)));
              }
              return Command.SINGLE_SUCCESS;
            })
        .build();
  }

  private static Component state(String label, boolean on) {
    return Component.text(label + " are now ")
        .append(
            on
                ? Component.text("on", NamedTextColor.GREEN)
                : Component.text("off", NamedTextColor.RED));
  }
}
