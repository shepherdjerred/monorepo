package com.shepherdjerred.thestorm.qol.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.word;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.List;
import java.util.function.Consumer;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/** {@code /bank} and {@code /mondo}. */
final class BankCommands {

  private static final String ITEM = "item";
  private static final String PLAYER = "player";
  private static final String ROLE = "role";

  private final Banks banks;

  BankCommands(Banks banks) {
    this.banks = banks;
  }

  void register(Commands commands) {
    var access =
        Commands.literal("access")
            .then(
                Commands.literal("add")
                    .then(
                        Commands.argument(PLAYER, word())
                            .executes(
                                context -> player(context, actor -> grant(context, actor, null)))
                            .then(
                                Commands.argument(ROLE, word())
                                    .executes(
                                        context ->
                                            player(
                                                context,
                                                actor ->
                                                    grant(
                                                        context,
                                                        actor,
                                                        StringArgumentType.getString(
                                                            context, ROLE)))))))
            .then(
                Commands.literal("remove")
                    .then(
                        Commands.argument(PLAYER, word())
                            .executes(
                                context ->
                                    player(
                                        context,
                                        actor ->
                                            banks.revoke(
                                                actor,
                                                StringArgumentType.getString(context, PLAYER))))));
    var root =
        Commands.literal("bank")
            .executes(context -> player(context, banks::describe))
            .then(Commands.literal("add").executes(context -> player(context, banks::add)))
            .then(
                Commands.literal("find")
                    .then(
                        Commands.argument(ITEM, word())
                            .executes(
                                context ->
                                    player(
                                        context,
                                        actor ->
                                            banks.find(
                                                actor,
                                                StringArgumentType.getString(context, ITEM))))))
            .then(Commands.literal("list").executes(context -> player(context, banks::list)))
            .then(Commands.literal("quit").executes(context -> player(context, banks::quit)))
            .then(Commands.literal("check").executes(context -> player(context, banks::check)))
            .then(Commands.literal("reload").executes(context -> player(context, banks::reload)))
            .then(access);
    commands.register(root.build(), "Deposit banks", List.of("mondo"));
  }

  private void grant(
      CommandContext<CommandSourceStack> context, Player player, @Nullable String role) {
    banks.grant(player, StringArgumentType.getString(context, PLAYER), role);
  }

  private static int player(CommandContext<CommandSourceStack> context, Consumer<Player> action) {
    if (context.getSource().getSender() instanceof Player player) {
      action.accept(player);
      return Command.SINGLE_SUCCESS;
    }
    Say.error(context.getSource().getSender(), Banks.LABEL, "Only players can do that.");
    return 0;
  }
}
