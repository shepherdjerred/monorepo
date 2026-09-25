package com.shepherdjerred.thestorm.chat.adapter.paper;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.chat.app.ChatService;
import com.shepherdjerred.thestorm.chat.app.Correspondent;
import com.shepherdjerred.thestorm.chat.app.PrivateLine;
import com.shepherdjerred.thestorm.chat.domain.ChatDenial;
import com.shepherdjerred.thestorm.core.result.Result;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import io.papermc.paper.command.brigadier.argument.ArgumentTypes;
import io.papermc.paper.command.brigadier.argument.resolvers.selector.PlayerSelectorArgumentResolver;
import java.util.List;
import org.bukkit.Server;
import org.bukkit.entity.Player;

/**
 * Private messages: {@code /msg <player> <message>} (also {@code /tell}, {@code /whisper} and
 * {@code /w}) and {@code /r <message>}. They replace the vanilla commands and follow chat's rules:
 * mutes, ignores, the caps, repeat and length limits, and escaping.
 */
public final class PrivateCommands {

  /** The labels of the message command; each replaces the vanilla command of that name. */
  static final List<String> MESSAGE_LABELS = List.of("msg", "tell", "whisper", "w");

  private static final String PLAYER = "player";
  private static final String MESSAGE = "message";

  private final ChatService service;
  private final PaperChatOutput output;
  private final Server server;

  public PrivateCommands(ChatService service, PaperChatOutput output, Server server) {
    this.service = service;
    this.output = output;
    this.server = server;
  }

  /** Registers {@code /msg}, its other labels, and {@code /r}. */
  public void register(Commands commands) {
    for (var label : MESSAGE_LABELS) {
      // Separate commands, not aliases: Paper lets a label replace a vanilla command, not an alias.
      commands.register(messageCommand(label), "Send a player a private message");
    }
    commands.register(replyCommand(), "Reply to your last private message");
  }

  private LiteralCommandNode<CommandSourceStack> messageCommand(String label) {
    return Commands.literal(label)
        .requires(source -> source.getSender() instanceof Player)
        .then(
            Commands.argument(PLAYER, ArgumentTypes.player())
                .then(
                    Commands.argument(MESSAGE, StringArgumentType.greedyString())
                        .executes(
                            context ->
                                send(
                                    sender(context),
                                    recipient(context),
                                    StringArgumentType.getString(context, MESSAGE)))))
        .build();
  }

  private LiteralCommandNode<CommandSourceStack> replyCommand() {
    return Commands.literal("r")
        .requires(source -> source.getSender() instanceof Player)
        .then(
            Commands.argument(MESSAGE, StringArgumentType.greedyString())
                .executes(
                    context ->
                        reply(sender(context), StringArgumentType.getString(context, MESSAGE))))
        .build();
  }

  private int reply(Player sender, String message) {
    var target = service.replyTarget(sender.getUniqueId());
    if (target.isEmpty()) {
      sender.sendMessage(Feedback.error("Nobody has messaged you yet."));
      return Command.SINGLE_SUCCESS;
    }
    var recipient = server.getPlayer(target.get().id());
    if (recipient == null) {
      sender.sendMessage(Feedback.error(target.get().name() + " is not online."));
      return Command.SINGLE_SUCCESS;
    }
    return send(sender, recipient, message);
  }

  private int send(Player sender, Player recipient, String message) {
    var to = new Correspondent(recipient.getUniqueId(), recipient.getName());
    switch (service.preparePrivate(Speakers.of(sender), to, message)) {
      case Result.Ok<PrivateLine, List<ChatDenial>>(var line) -> {
        output.deliverPrivate(line, sender, recipient);
        Feedback.noticeCalmed(sender, line.message(), service.capsNotice());
      }
      case Result.Err<PrivateLine, List<ChatDenial>>(var denials) ->
          sender.sendMessage(Feedback.denials(denials));
    }
    return Command.SINGLE_SUCCESS;
  }

  private static Player sender(CommandContext<CommandSourceStack> context) {
    if (context.getSource().getSender() instanceof Player player) {
      return player;
    }
    throw new IllegalStateException("private messages are registered for players only");
  }

  private static Player recipient(CommandContext<CommandSourceStack> context)
      throws CommandSyntaxException {
    return context
        .getArgument(PLAYER, PlayerSelectorArgumentResolver.class)
        .resolve(context.getSource())
        .getFirst();
  }
}
