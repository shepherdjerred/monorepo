package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.greedyString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;
import static io.papermc.paper.command.brigadier.Commands.argument;
import static io.papermc.paper.command.brigadier.Commands.literal;
import static java.time.format.DateTimeFormatter.ofPattern;

import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.suggestion.SuggestionProvider;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.app.ModerationService;
import com.shepherdjerred.thestorm.essentials.app.PlayerDirectory;
import com.shepherdjerred.thestorm.essentials.domain.moderation.Actor;
import com.shepherdjerred.thestorm.essentials.domain.moderation.AuditEntry;
import com.shepherdjerred.thestorm.essentials.domain.moderation.Ban;
import com.shepherdjerred.thestorm.essentials.domain.moderation.ModerationAction;
import com.shepherdjerred.thestorm.essentials.domain.place.DurationText;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.time.Duration;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Stream;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/**
 * {@code /kick}, {@code /ban}, {@code /tempban}, {@code /unban} and {@code /history}. Every action
 * is written to the audit log. Mutes belong to the chat module.
 */
final class ModerationCommands {

  private static final String NO_REASON = "No reason given";
  private static final int HISTORY_LIMIT = 10;
  private static final DateTimeFormatter WHEN =
      ofPattern("yyyy-MM-dd HH:mm 'UTC'").withZone(ZoneOffset.UTC);

  private final PaperRuntime runtime;
  private final ModerationService moderation;
  private final PlayerDirectory players;

  ModerationCommands(PaperRuntime runtime, ModerationService moderation, PlayerDirectory players) {
    this.runtime = runtime;
    this.moderation = moderation;
    this.players = players;
  }

  /** A player named in a command, online or not. */
  private record Target(UUID uuid, String name, Optional<Player> online) {}

  void register(Commands commands) {
    commands.register(
        literal("kick")
            .requires(Cmd.permission(EssentialsPermissions.KICK))
            .then(
                argument("player", word())
                    .suggests(Cmd.onlinePlayers(runtime.server()))
                    .executes(context -> kick(context, NO_REASON))
                    .then(
                        argument("reason", greedyString())
                            .executes(context -> kick(context, Cmd.string(context, "reason")))))
            .build(),
        "Kick a player");
    commands.register(
        literal("ban")
            .requires(Cmd.permission(EssentialsPermissions.BAN))
            .then(
                argument("player", word())
                    .suggests(knownPlayers())
                    .executes(context -> ban(context, Optional.empty(), NO_REASON))
                    .then(
                        argument("reason", greedyString())
                            .executes(
                                context ->
                                    ban(context, Optional.empty(), Cmd.string(context, "reason")))))
            .build(),
        "Ban a player permanently");
    commands.register(
        literal("tempban")
            .requires(Cmd.permission(EssentialsPermissions.BAN))
            .then(
                argument("player", word())
                    .suggests(knownPlayers())
                    .then(
                        argument("duration", word())
                            .executes(context -> tempban(context, NO_REASON))
                            .then(
                                argument("reason", greedyString())
                                    .executes(
                                        context ->
                                            tempban(context, Cmd.string(context, "reason"))))))
            .build(),
        "Ban a player for a while, for example /tempban name 3d griefing");
    registerUnbanAndHistory(commands);
  }

  private void registerUnbanAndHistory(Commands commands) {
    commands.register(
        literal("unban")
            .requires(Cmd.permission(EssentialsPermissions.BAN))
            .then(
                argument("player", word())
                    .suggests(knownPlayers())
                    .executes(context -> unban(context, NO_REASON))
                    .then(
                        argument("reason", greedyString())
                            .executes(context -> unban(context, Cmd.string(context, "reason")))))
            .build(),
        "Lift a ban");
    commands.register(
        literal("history")
            .requires(Cmd.permission(EssentialsPermissions.HISTORY))
            .then(argument("player", word()).suggests(knownPlayers()).executes(this::history))
            .build(),
        "Show a player's moderation history");
  }

  private int kick(CommandContext<CommandSourceStack> context, String reason) {
    var sender = context.getSource().getSender();
    if (tooLong(sender, reason)) {
      return 0;
    }
    var name = Cmd.string(context, "player");
    var player = runtime.server().getPlayerExact(name);
    if (player == null) {
      Say.error(sender, Say.MODERATION, name + " is not online.");
      return 0;
    }
    var entry =
        AuditEntry.of(
            player.getUniqueId(),
            ModerationAction.KICK,
            actor(sender),
            AuditEntry.Term.permanent(reason, runtime.time().instant()));
    runtime.logFailure(moderation.record(entry), "recording a kick");
    player.kick(BanMessages.kicked(reason));
    staff(sender.getName() + " kicked " + player.getName() + ": " + reason);
    return Cmd.OK;
  }

  private int ban(
      CommandContext<CommandSourceStack> context, Optional<Duration> length, String reason) {
    var sender = context.getSource().getSender();
    if (tooLong(sender, reason)) {
      return 0;
    }
    var target = resolve(sender, Cmd.string(context, "player"));
    if (target.isEmpty()) {
      return 0;
    }
    var found = target.orElseThrow();
    var now = runtime.time().instant();
    var entry =
        AuditEntry.of(
            found.uuid(),
            ModerationAction.BAN,
            actor(sender),
            new AuditEntry.Term(length, reason, now));
    runtime.logFailure(moderation.record(entry), "recording a ban");
    var ban = new Ban(reason, entry.actor(), now, entry.expiresAt());
    found.online().ifPresent(player -> player.kick(BanMessages.banned(ban, now)));
    var term = length.map(l -> " for " + DurationText.format(l)).orElse(" permanently");
    staff(sender.getName() + " banned " + found.name() + term + ": " + reason);
    return Cmd.OK;
  }

  private int tempban(CommandContext<CommandSourceStack> context, String reason) {
    return switch (DurationText.parse(Cmd.string(context, "duration"))) {
      case Result.Ok<Duration, String>(var length) -> ban(context, Optional.of(length), reason);
      case Result.Err<Duration, String>(var error) -> {
        Say.error(context.getSource().getSender(), Say.MODERATION, error);
        yield 0;
      }
    };
  }

  private int unban(CommandContext<CommandSourceStack> context, String reason) {
    var sender = context.getSource().getSender();
    if (tooLong(sender, reason)) {
      return 0;
    }
    var target = resolve(sender, Cmd.string(context, "player"));
    if (target.isEmpty()) {
      return 0;
    }
    var found = target.orElseThrow();
    runtime.onMain(
        moderation.activeBan(found.uuid()),
        "checking a ban",
        ban -> {
          if (ban.isEmpty()) {
            Say.error(sender, Say.MODERATION, found.name() + " is not banned.");
            return;
          }
          var entry =
              AuditEntry.of(
                  found.uuid(),
                  ModerationAction.UNBAN,
                  actor(sender),
                  AuditEntry.Term.permanent(reason, runtime.time().instant()));
          runtime.logFailure(moderation.record(entry), "recording an unban");
          staff(sender.getName() + " unbanned " + found.name() + ": " + reason);
        });
    return Cmd.OK;
  }

  private int history(CommandContext<CommandSourceStack> context) {
    var sender = context.getSource().getSender();
    var target = resolve(sender, Cmd.string(context, "player"));
    if (target.isEmpty()) {
      return 0;
    }
    var found = target.orElseThrow();
    runtime.onMain(
        moderation.history(found.uuid(), HISTORY_LIMIT),
        "loading moderation history",
        entries -> showHistory(sender, found.name(), entries));
    return Cmd.OK;
  }

  private void showHistory(CommandSender sender, String name, List<AuditEntry> entries) {
    if (entries.isEmpty()) {
      Say.info(sender, Say.MODERATION, name + " has a clean record.");
      return;
    }
    Say.info(
        sender, Say.MODERATION, name + "'s last " + entries.size() + " actions, newest first:");
    for (var entry : entries) {
      var until = entry.expiresAt().map(end -> " (until " + WHEN.format(end) + ")").orElse("");
      Say.info(
          sender,
          Say.MODERATION,
          WHEN.format(entry.at())
              + " "
              + entry.action().id()
              + " by "
              + entry.actor().name()
              + until
              + ": "
              + entry.reason());
    }
  }

  private Optional<Target> resolve(CommandSender sender, String name) {
    var online = runtime.server().getPlayerExact(name);
    if (online != null) {
      return Optional.of(new Target(online.getUniqueId(), online.getName(), Optional.of(online)));
    }
    var known = players.find(name);
    if (known.isEmpty()) {
      Say.error(sender, Say.MODERATION, "No player called " + name + " has joined The Storm.");
      return Optional.empty();
    }
    var player = known.orElseThrow();
    return Optional.of(new Target(player.uuid(), player.name(), Optional.empty()));
  }

  private static boolean tooLong(CommandSender sender, String reason) {
    if (reason.length() <= AuditEntry.MAX_REASON_LENGTH) {
      return false;
    }
    Say.error(
        sender,
        Say.MODERATION,
        "Keep the reason under " + AuditEntry.MAX_REASON_LENGTH + " characters.");
    return true;
  }

  private void staff(String message) {
    runtime.server().getOnlinePlayers().stream()
        .filter(player -> player.hasPermission(EssentialsPermissions.KICK))
        .forEach(player -> Say.info(player, Say.MODERATION, message));
    runtime.logger().info("essentials moderation: {}", message);
  }

  private SuggestionProvider<CommandSourceStack> knownPlayers() {
    return Cmd.suggest(
        () ->
            Stream.concat(
                    runtime.server().getOnlinePlayers().stream().map(Player::getName),
                    players.names().stream())
                .distinct()
                .toList());
  }

  private static Actor actor(CommandSender sender) {
    return sender instanceof Player player
        ? Actor.player(player.getUniqueId(), player.getName())
        : Actor.CONSOLE;
  }
}
