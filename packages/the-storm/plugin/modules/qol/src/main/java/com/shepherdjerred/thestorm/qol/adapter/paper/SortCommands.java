package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.context.CommandContext;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.List;
import java.util.function.Consumer;
import org.bukkit.entity.Player;

/** {@code /sort}, {@code /chestsort} and {@code /isort}. */
final class SortCommands {

  private final SortBehavior sorting;

  SortCommands(SortBehavior sorting) {
    this.sorting = sorting;
  }

  void register(Commands commands) {
    var root =
        Commands.literal("sort")
            .requires(source -> source.getSender().hasPermission(QolPermissions.SORT))
            .executes(context -> player(context, sorting::openMenu))
            .then(
                Commands.literal("on")
                    .executes(context -> player(context, actor -> sorting.containers(actor, "on"))))
            .then(
                Commands.literal("off")
                    .executes(
                        context -> player(context, actor -> sorting.containers(actor, "off"))))
            .then(
                Commands.literal("toggle")
                    .executes(
                        context -> player(context, actor -> sorting.containers(actor, "toggle"))))
            .then(
                Commands.literal("hotkeys").executes(context -> player(context, sorting::hotkeys)))
            .then(
                Commands.literal("inventory")
                    .executes(context -> player(context, sorting::inventory)))
            .then(Commands.literal("hotbar").executes(context -> player(context, sorting::hotbar)))
            .then(Commands.literal("all").executes(context -> player(context, sorting::all)));
    commands.register(root.build(), "Sorting settings and commands", List.of("chestsort", "isort"));
  }

  private static int player(CommandContext<CommandSourceStack> context, Consumer<Player> action) {
    if (context.getSource().getSender() instanceof Player player) {
      action.accept(player);
      return Command.SINGLE_SUCCESS;
    }
    Say.error(context.getSource().getSender(), Say.SORT, "Only players can do that.");
    return 0;
  }
}
