package com.shepherdjerred.thestorm.chat.adapter.paper;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.suggestion.Suggestions;
import com.mojang.brigadier.suggestion.SuggestionsBuilder;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.chat.app.ChatService;
import com.shepherdjerred.thestorm.chat.domain.Durations;
import com.shepherdjerred.thestorm.core.result.Result;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.time.Duration;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import org.bukkit.OfflinePlayer;
import org.bukkit.Server;
import org.bukkit.command.CommandSender;

/** Staff chat moderation: {@code /mute <player> <duration> <reason>} and {@code /unmute}. */
public final class MuteCommands {

  private static final String PLAYER = "player";
  private static final String DURATION = "duration";
  private static final String REASON = "reason";

  private final ChatService service;
  private final Server server;

  public MuteCommands(ChatService service, Server server) {
    this.service = service;
    this.server = server;
  }

  /** Registers {@code /mute} and {@code /unmute}. */
  public void register(Commands commands) {
    commands.register(muteCommand(), "Mute a player's chat for a while, with a reason");
    commands.register(unmuteCommand(), "Lift a player's chat mute");
  }

  private LiteralCommandNode<CommandSourceStack> muteCommand() {
    return Commands.literal("mute")
        .requires(source -> source.getSender().hasPermission(Speakers.MUTE))
        .then(
            Commands.argument(PLAYER, StringArgumentType.word())
                .suggests(this::suggestOnline)
                .then(
                    Commands.argument(DURATION, StringArgumentType.word())
                        .then(
                            Commands.argument(REASON, StringArgumentType.greedyString())
                                .executes(this::mute))))
        .build();
  }

  private LiteralCommandNode<CommandSourceStack> unmuteCommand() {
    return Commands.literal("unmute")
        .requires(source -> source.getSender().hasPermission(Speakers.MUTE))
        .then(
            Commands.argument(PLAYER, StringArgumentType.word())
                .suggests(this::suggestOnline)
                .executes(this::unmute))
        .build();
  }

  private int mute(CommandContext<CommandSourceStack> context) {
    var sender = context.getSource().getSender();
    var name = StringArgumentType.getString(context, PLAYER);
    var target = known(name);
    if (target.isEmpty()) {
      sender.sendMessage(Feedback.error("No player called " + name + " has played here."));
      return Command.SINGLE_SUCCESS;
    }
    var reason = StringArgumentType.getString(context, REASON).strip();
    switch (Durations.parse(StringArgumentType.getString(context, DURATION))) {
      case Result.Ok<Duration, String>(var length) -> {
        var mute = service.mute(target.get(), length, reason, sender.getName());
        var shown = Durations.format(length);
        tellStaff(sender, sender.getName() + " muted " + name + " for " + shown + ": " + reason);
        var online = server.getPlayer(target.get());
        if (online != null) {
          online.sendMessage(Feedback.error("You are muted for " + shown + ": " + mute.reason()));
        }
      }
      case Result.Err<Duration, String>(var problem) -> sender.sendMessage(Feedback.error(problem));
    }
    return Command.SINGLE_SUCCESS;
  }

  private int unmute(CommandContext<CommandSourceStack> context) {
    var sender = context.getSource().getSender();
    var name = StringArgumentType.getString(context, PLAYER);
    var target = known(name);
    if (target.isEmpty() || !service.unmute(target.get())) {
      sender.sendMessage(Feedback.error(name + " is not muted."));
      return Command.SINGLE_SUCCESS;
    }
    tellStaff(sender, sender.getName() + " unmuted " + name + ".");
    var online = server.getPlayer(target.get());
    if (online != null) {
      online.sendMessage(Feedback.success("You can chat again."));
    }
    return Command.SINGLE_SUCCESS;
  }

  /** The player called {@code name}, online or seen before. Reads only the server's caches. */
  private Optional<UUID> known(String name) {
    var online = server.getPlayerExact(name);
    if (online != null) {
      return Optional.of(online.getUniqueId());
    }
    return Optional.ofNullable(server.getOfflinePlayerIfCached(name))
        .map(OfflinePlayer::getUniqueId);
  }

  private void tellStaff(CommandSender sender, String message) {
    Component line = Feedback.info(message);
    sender.sendMessage(line);
    for (var player : server.getOnlinePlayers()) {
      if (!player.equals(sender) && Speakers.isStaff(player)) {
        player.sendMessage(line);
      }
    }
  }

  private CompletableFuture<Suggestions> suggestOnline(
      CommandContext<CommandSourceStack> context, SuggestionsBuilder builder) {
    var typed = builder.getRemainingLowerCase();
    for (var player : server.getOnlinePlayers()) {
      if (player.getName().toLowerCase(Locale.ROOT).startsWith(typed)) {
        builder.suggest(player.getName());
      }
    }
    return builder.buildFuture();
  }
}
