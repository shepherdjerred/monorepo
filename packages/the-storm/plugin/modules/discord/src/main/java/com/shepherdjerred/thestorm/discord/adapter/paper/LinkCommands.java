package com.shepherdjerred.thestorm.discord.adapter.paper;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.discord.app.Links;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.function.Function;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.entity.Player;
import org.slf4j.Logger;

/**
 * {@code /discord link <code>}, {@code /discord unlink} and {@code /discord dms <on|off>}. Saves
 * run off the main thread; answers come back on it.
 */
public final class LinkCommands {

  private static final String CODE = "code";

  private final Links links;
  private final Executor mainThread;
  private final Logger logger;

  public LinkCommands(Links links, Executor mainThread, Logger logger) {
    this.links = links;
    this.mainThread = mainThread;
    this.logger = logger;
  }

  /** Registers {@code /discord}. */
  public void register(Commands commands) {
    commands.register(discord(), "Link your Minecraft player to Discord");
  }

  private LiteralCommandNode<CommandSourceStack> discord() {
    return Commands.literal("discord")
        .executes(this::usage)
        .then(
            Commands.literal("link")
                .executes(this::usage)
                .then(
                    Commands.argument(CODE, StringArgumentType.word())
                        .executes(
                            context ->
                                asPlayer(
                                    context,
                                    player ->
                                        links
                                            .confirm(
                                                player, StringArgumentType.getString(context, CODE))
                                            .thenApply(
                                                linked ->
                                                    linked.isPresent()
                                                        ? ok(
                                                            "Linked to Discord. Use /discord dms"
                                                                + " on to get your minigame results"
                                                                + " there.")
                                                        : error(
                                                            "That code is wrong or expired. Use"
                                                                + " /link in Discord for a new"
                                                                + " one."))))))
        .then(
            Commands.literal("unlink")
                .executes(
                    context ->
                        asPlayer(
                            context,
                            player ->
                                links
                                    .unlink(player)
                                    .thenApply(
                                        removed ->
                                            removed
                                                ? ok("Unlinked from Discord.")
                                                : error("You are not linked to Discord.")))))
        .then(
            Commands.literal("dms")
                .then(Commands.literal("on").executes(context -> dms(context, true)))
                .then(Commands.literal("off").executes(context -> dms(context, false))))
        .build();
  }

  private int dms(CommandContext<CommandSourceStack> context, boolean on) {
    return asPlayer(
        context,
        player ->
            links
                .setDms(player, on)
                .thenApply(
                    linked ->
                        !linked
                            ? error("Link to Discord first: use /link in The Storm's Discord.")
                            : ok(
                                on
                                    ? "Your minigame results will be sent to you on Discord."
                                    : "Your minigame results will no longer be sent to you.")));
  }

  private int usage(CommandContext<CommandSourceStack> context) {
    context
        .getSource()
        .getSender()
        .sendMessage(
            Component.text(
                "Use /link in The Storm's Discord, then /discord link <code> here."
                    + " /discord unlink and /discord dms <on|off> manage it.",
                NamedTextColor.GRAY));
    return Command.SINGLE_SUCCESS;
  }

  private int asPlayer(
      CommandContext<CommandSourceStack> context,
      Function<UUID, CompletableFuture<Component>> work) {
    if (!(context.getSource().getSender() instanceof Player player)) {
      context
          .getSource()
          .getSender()
          .sendMessage(error("Only players can link a Discord account."));
      return Command.SINGLE_SUCCESS;
    }
    var _ =
        work.apply(player.getUniqueId())
            .whenCompleteAsync(
                (reply, failure) -> {
                  if (failure != null) {
                    logger.error("A Discord link command failed", failure);
                    player.sendMessage(error("That did not work; try again in a moment."));
                  } else if (player.isOnline()) {
                    player.sendMessage(reply);
                  }
                },
                mainThread);
    return Command.SINGLE_SUCCESS;
  }

  private static Component ok(String text) {
    return Component.text(text, NamedTextColor.GREEN);
  }

  private static Component error(String text) {
    return Component.text(text, NamedTextColor.RED);
  }
}
