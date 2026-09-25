package com.shepherdjerred.thestorm.chat.adapter.paper;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.mojang.brigadier.suggestion.Suggestions;
import com.mojang.brigadier.suggestion.SuggestionsBuilder;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.chat.app.ChannelStatus;
import com.shepherdjerred.thestorm.chat.app.ChatService;
import com.shepherdjerred.thestorm.chat.app.GlobalChatHub;
import com.shepherdjerred.thestorm.chat.app.OutgoingLine;
import com.shepherdjerred.thestorm.chat.domain.ChannelAccess;
import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.chat.domain.ChatDenial;
import com.shepherdjerred.thestorm.chat.domain.ChatProfile;
import com.shepherdjerred.thestorm.chat.domain.ProfileError;
import com.shepherdjerred.thestorm.core.result.Result;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import io.papermc.paper.command.brigadier.argument.ArgumentTypes;
import io.papermc.paper.command.brigadier.argument.resolvers.selector.PlayerSelectorArgumentResolver;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.JoinConfiguration;
import org.bukkit.entity.Player;

/** The chat commands: channel switches and one-shots, ignores, channel visibility. */
public final class ChatCommands {

  private static final String MESSAGE = "message";
  private static final String PLAYER = "player";
  private static final String CHANNEL = "channel";

  private final ChatService service;
  private final GlobalChatHub hub;
  private final PaperChatOutput output;

  public ChatCommands(ChatService service, GlobalChatHub hub, PaperChatOutput output) {
    this.service = service;
    this.hub = hub;
    this.output = output;
  }

  /**
   * Registers every command on {@code commands}; staff moderation lives in {@link MuteCommands}.
   */
  public void register(Commands commands) {
    for (var channel : ChannelKey.values()) {
      commands.register(
          channelCommand(channel),
          "Talk in " + channel.displayName() + " chat, or send one message there");
    }
    commands.register(ignoreCommand(), "Ignore a player's chat, or list who you ignore");
    commands.register(unignoreCommand(), "Stop ignoring a player");
    commands.register(channelsCommand(), "List chat channels, or hide and show them");
  }

  /** The command that switches to {@code channel}. */
  static String label(ChannelKey channel) {
    return switch (channel) {
      case GLOBAL -> "g";
      case WAR -> "w";
      case STAFF -> "sc";
      case TOWN -> "tc";
      case NATION -> "nc";
    };
  }

  private LiteralCommandNode<CommandSourceStack> channelCommand(ChannelKey channel) {
    return Commands.literal(label(channel))
        .requires(
            source ->
                source.getSender() instanceof Player player
                    && (channel != ChannelKey.STAFF || Speakers.isStaff(player)))
        .executes(context -> focus(player(context), channel))
        .then(
            Commands.argument(MESSAGE, StringArgumentType.greedyString())
                .executes(
                    context ->
                        say(
                            player(context),
                            channel,
                            StringArgumentType.getString(context, MESSAGE))))
        .build();
  }

  private LiteralCommandNode<CommandSourceStack> ignoreCommand() {
    return Commands.literal("ignore")
        .requires(ChatCommands::isPlayer)
        .executes(context -> listIgnored(player(context)))
        .then(
            Commands.argument(PLAYER, ArgumentTypes.player())
                .executes(context -> ignore(player(context), target(context))))
        .build();
  }

  private LiteralCommandNode<CommandSourceStack> unignoreCommand() {
    return Commands.literal("unignore")
        .requires(ChatCommands::isPlayer)
        .then(
            Commands.argument(PLAYER, StringArgumentType.word())
                .suggests(this::suggestIgnored)
                .executes(
                    context ->
                        unignore(player(context), StringArgumentType.getString(context, PLAYER))))
        .build();
  }

  private LiteralCommandNode<CommandSourceStack> channelsCommand() {
    return Commands.literal("channels")
        .requires(ChatCommands::isPlayer)
        .executes(context -> listChannels(player(context)))
        .then(
            Commands.literal("hide")
                .then(
                    Commands.argument(CHANNEL, StringArgumentType.word())
                        .suggests(ChatCommands::suggestChannels)
                        .executes(context -> setHidden(context, true))))
        .then(
            Commands.literal("show")
                .then(
                    Commands.argument(CHANNEL, StringArgumentType.word())
                        .suggests(ChatCommands::suggestChannels)
                        .executes(context -> setHidden(context, false))))
        .build();
  }

  private int focus(Player player, ChannelKey channel) {
    switch (service.focus(Speakers.of(player), channel)) {
      case Result.Ok<ChatProfile, ChatDenial> _ ->
          player.sendMessage(
              Feedback.success("You are now talking in " + channel.displayName() + " chat."));
      case Result.Err<ChatProfile, ChatDenial>(var denial) ->
          player.sendMessage(Feedback.error(Feedback.describe(denial)));
    }
    return Command.SINGLE_SUCCESS;
  }

  private int say(Player player, ChannelKey channel, String message) {
    switch (service.prepare(Speakers.of(player), channel, message)) {
      case Result.Ok<OutgoingLine, List<ChatDenial>>(var line) -> {
        output.deliver(line);
        hub.published(line);
      }
      case Result.Err<OutgoingLine, List<ChatDenial>>(var denials) ->
          player.sendMessage(Feedback.denials(denials));
    }
    return Command.SINGLE_SUCCESS;
  }

  private int listIgnored(Player player) {
    var names = service.profile(player.getUniqueId()).ignored().values().stream().sorted().toList();
    player.sendMessage(
        names.isEmpty()
            ? Feedback.info("You are not ignoring anyone.")
            : Feedback.info("You ignore: " + String.join(", ", names)));
    return Command.SINGLE_SUCCESS;
  }

  private int ignore(Player player, Player target) {
    var request =
        new ChatProfile.IgnoreTarget(
            target.getUniqueId(), target.getName(), Speakers.isStaff(target));
    reply(
        player,
        service.ignore(player.getUniqueId(), request),
        "You no longer see messages from " + target.getName() + ".");
    return Command.SINGLE_SUCCESS;
  }

  private int unignore(Player player, String name) {
    var target = service.profile(player.getUniqueId()).ignoredNamed(name);
    if (target.isEmpty()) {
      player.sendMessage(Feedback.error("You do not ignore anyone called " + name + "."));
      return Command.SINGLE_SUCCESS;
    }
    reply(
        player,
        service.unignore(player.getUniqueId(), target.get()),
        "You see messages from " + name + " again.");
    return Command.SINGLE_SUCCESS;
  }

  private int listChannels(Player player) {
    var lines =
        service.channels(Speakers.of(player)).stream()
            .filter(status -> status.access() != ChannelAccess.NO_PERMISSION)
            .map(ChatCommands::describe)
            .toList();
    player.sendMessage(
        Component.join(
            JoinConfiguration.newlines(),
            Feedback.info("Channels (/channels hide|show <channel>):"),
            Component.join(JoinConfiguration.newlines(), lines)));
    return Command.SINGLE_SUCCESS;
  }

  private int setHidden(CommandContext<CommandSourceStack> context, boolean hidden) {
    var player = player(context);
    var id = StringArgumentType.getString(context, CHANNEL);
    var channel = ChannelKey.fromId(id);
    if (channel.isEmpty()) {
      player.sendMessage(Feedback.error("There is no channel called " + id + "."));
      return Command.SINGLE_SUCCESS;
    }
    var key = channel.get();
    if (hidden) {
      reply(
          player, service.hide(player.getUniqueId(), key), key.displayName() + " chat is hidden.");
    } else {
      reply(
          player,
          service.show(player.getUniqueId(), key),
          key.displayName() + " chat is shown again.");
    }
    return Command.SINGLE_SUCCESS;
  }

  private static Component describe(ChannelStatus status) {
    var channel = status.channel();
    return Component.text(
        " "
            + channel.displayName()
            + " (/"
            + label(channel)
            + ", "
            + channel.id()
            + "): "
            + state(status));
  }

  private static String state(ChannelStatus status) {
    if (status.focused()) {
      return "talking here";
    }
    if (status.hidden()) {
      return "hidden";
    }
    return status.access() == ChannelAccess.GRANTED
        ? "listening"
        : Feedback.describe(status.channel(), status.access());
  }

  private static void reply(
      Player player, Result<ChatProfile, ProfileError> result, String onSuccess) {
    switch (result) {
      case Result.Ok<ChatProfile, ProfileError> _ ->
          player.sendMessage(Feedback.success(onSuccess));
      case Result.Err<ChatProfile, ProfileError>(var error) ->
          player.sendMessage(Feedback.error(Feedback.describe(error)));
    }
  }

  private CompletableFuture<Suggestions> suggestIgnored(
      CommandContext<CommandSourceStack> context, SuggestionsBuilder builder) {
    if (context.getSource().getSender() instanceof Player player) {
      service.profile(player.getUniqueId()).ignored().values().stream()
          .filter(name -> name.toLowerCase(Locale.ROOT).startsWith(builder.getRemainingLowerCase()))
          .forEach(builder::suggest);
    }
    return builder.buildFuture();
  }

  private static CompletableFuture<Suggestions> suggestChannels(
      CommandContext<CommandSourceStack> context, SuggestionsBuilder builder) {
    Arrays.stream(ChannelKey.values())
        .map(ChannelKey::id)
        .filter(id -> id.startsWith(builder.getRemainingLowerCase()))
        .forEach(builder::suggest);
    return builder.buildFuture();
  }

  private static boolean isPlayer(CommandSourceStack source) {
    return source.getSender() instanceof Player;
  }

  private static Player player(CommandContext<CommandSourceStack> context) {
    if (context.getSource().getSender() instanceof Player player) {
      return player;
    }
    throw new IllegalStateException("chat commands are registered for players only");
  }

  private static Player target(CommandContext<CommandSourceStack> context)
      throws CommandSyntaxException {
    return context
        .getArgument(PLAYER, PlayerSelectorArgumentResolver.class)
        .resolve(context.getSource())
        .getFirst();
  }
}
