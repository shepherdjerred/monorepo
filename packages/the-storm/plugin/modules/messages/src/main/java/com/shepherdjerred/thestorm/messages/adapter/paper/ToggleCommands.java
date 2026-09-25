package com.shepherdjerred.thestorm.messages.adapter.paper;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.messages.domain.Channel;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.entity.Player;

/**
 * {@code /toggle-tips} and {@code /toggle-ads}: mute or unmute an announcement channel. Only the
 * channels that are actually announced get a command.
 */
public final class ToggleCommands {

  private final PreferenceStore preferences;
  private final Set<Channel> channels;

  public ToggleCommands(PreferenceStore preferences, Set<Channel> channels) {
    this.preferences = preferences;
    this.channels = channels.isEmpty() ? Set.of() : Set.copyOf(EnumSet.copyOf(channels));
  }

  /** Registers the command for each announced channel. */
  public void register(Commands registrar) {
    for (var node : nodes()) {
      registrar.register(
          node, "Turn " + node.getLiteral().substring("toggle-".length()) + " on or off");
    }
  }

  /** The command nodes, in channel order. */
  public List<LiteralCommandNode<CommandSourceStack>> nodes() {
    return EnumSet.allOf(Channel.class).stream()
        .filter(channels::contains)
        .map(this::node)
        .toList();
  }

  private LiteralCommandNode<CommandSourceStack> node(Channel channel) {
    var label = label(channel);
    return Commands.literal("toggle-" + label.toLowerCase(Locale.ROOT))
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

  /** The announcement label for {@code channel}, such as {@code Tips}. */
  public static String label(Channel channel) {
    return switch (channel) {
      case TIPS -> "Tips";
      case ADS -> "Ads";
    };
  }

  private static Component state(String label, boolean on) {
    return Component.text(label + " are now ")
        .append(
            on
                ? Component.text("on", NamedTextColor.GREEN)
                : Component.text("off", NamedTextColor.RED));
  }
}
