package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.suggestion.SuggestionProvider;
import com.mojang.brigadier.suggestion.SuggestionsBuilder;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import java.util.Collection;
import java.util.Locale;
import java.util.function.Consumer;
import java.util.function.Predicate;
import java.util.function.Supplier;
import org.bukkit.Server;
import org.bukkit.entity.Player;

/** Small helpers shared by the Brigadier commands. */
final class Cmd {

  /** Brigadier's success value. */
  static final int OK = Command.SINGLE_SUCCESS;

  private Cmd() {}

  /** Requires {@code permission} to see and run a command. */
  static Predicate<CommandSourceStack> permission(String permission) {
    return source -> source.getSender().hasPermission(permission);
  }

  /** Runs {@code action} for a player sender; tells anyone else the command is for players. */
  static int asPlayer(CommandContext<CommandSourceStack> context, Consumer<Player> action) {
    if (context.getSource().getSender() instanceof Player player) {
      action.accept(player);
      return OK;
    }
    Say.error(context.getSource().getSender(), Say.STORM, "Only players can do that.");
    return 0;
  }

  /** A string argument's value. */
  static String string(CommandContext<CommandSourceStack> context, String name) {
    return StringArgumentType.getString(context, name);
  }

  /** Suggests {@code options} that start with what the player has typed. */
  static SuggestionProvider<CommandSourceStack> suggest(Supplier<Collection<String>> options) {
    return (context, builder) -> {
      addMatching(builder, options.get());
      return builder.buildFuture();
    };
  }

  /** Suggests online players' names. */
  static SuggestionProvider<CommandSourceStack> onlinePlayers(Server server) {
    return suggest(() -> server.getOnlinePlayers().stream().map(Player::getName).toList());
  }

  /** Adds each of {@code options} that starts with the typed text. */
  static void addMatching(SuggestionsBuilder builder, Collection<String> options) {
    var typed = builder.getRemaining().toLowerCase(Locale.ROOT);
    options.stream()
        .filter(option -> option.toLowerCase(Locale.ROOT).startsWith(typed))
        .forEach(builder::suggest);
  }
}
