package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.greedyString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;
import static io.papermc.paper.command.brigadier.Commands.argument;
import static io.papermc.paper.command.brigadier.Commands.literal;
import static java.time.format.DateTimeFormatter.ofPattern;

import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.suggestion.SuggestionProvider;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.app.ModerationService;
import com.shepherdjerred.thestorm.essentials.app.PlayerDirectory;
import com.shepherdjerred.thestorm.essentials.domain.moderation.Actor;
import com.shepherdjerred.thestorm.essentials.domain.moderation.AuditEntry;
import com.shepherdjerred.thestorm.essentials.domain.moderation.Ban;
import com.shepherdjerred.thestorm.essentials.domain.moderation.Exemption;
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
 * {@code /kick}, {@code /ban}, {@code /tempban}, {@code /unban} (also {@code /pardon}), {@code
 * /banlist} and {@code /history}. They replace the vanilla commands of the same names, so there is
 * one ban list. Every action is written to the audit log; staff are told, and banned players
 * kicked, only once the write succeeds. Players take names or UUIDs. Mutes belong to the chat
 * module.
 */
final class ModerationCommands {

  private static final String NO_REASON = "No reason given";
  private static final String PLAYER = "player";
  private static final String REASON = "reason";
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
                argument(PLAYER, word())
                    .suggests(Cmd.onlinePlayers(runtime.server()))
                    .executes(context -> kick(context, NO_REASON))
                    .then(
                        argument(REASON, greedyString())
                            .executes(context -> kick(context, Cmd.string(context, REASON)))))
            .build(),
        "Kick a player");
    commands.register(
        literal("ban")
            .requires(Cmd.permission(EssentialsPermissions.BAN))
            .then(
                argument(PLAYER, word())
                    .suggests(knownPlayers())
                    .executes(context -> ban(context, Optional.empty(), NO_REASON))
                    .then(
                        argument(REASON, greedyString())
                            .executes(
                                context ->
                                    ban(context, Optional.empty(), Cmd.string(context, REASON)))))
            .build(),
        "Ban a player permanently");
    commands.register(
        literal("tempban")
            .requires(Cmd.permission(EssentialsPermissions.BAN))
            .then(
                argument(PLAYER, word())
                    .suggests(knownPlayers())
                    .then(
                        argument("duration", word())
                            .executes(context -> tempban(context, NO_REASON))
                            .then(
                                argument(REASON, greedyString())
                                    .executes(
                                        context -> tempban(context, Cmd.string(context, REASON))))))
            .build(),
        "Ban a player for a while, for example /tempban name 3d griefing");
    registerListings(commands);
  }

  private void registerListings(Commands commands) {
    commands.register(unban().build(), "Lift a ban", List.of("pardon"));
    commands.register(
        literal("banlist")
            .requires(Cmd.permission(EssentialsPermissions.BAN))
            .executes(this::banlist)
            .build(),
        "List the bans in force");
    commands.register(
        literal("history")
            .requires(Cmd.permission(EssentialsPermissions.HISTORY))
            .then(argument(PLAYER, word()).suggests(knownPlayers()).executes(this::history))
            .build(),
        "Show a player's moderation history");
  }

  private LiteralArgumentBuilder<CommandSourceStack> unban() {
    return literal("unban")
        .requires(Cmd.permission(EssentialsPermissions.BAN))
        .then(
            argument(PLAYER, word())
                .suggests(knownPlayers())
                .executes(context -> unban(context, NO_REASON))
                .then(
                    argument(REASON, greedyString())
                        .executes(context -> unban(context, Cmd.string(context, REASON)))));
  }

  private int kick(CommandContext<CommandSourceStack> context, String reason) {
    var sender = context.getSource().getSender();
    if (tooLong(sender, reason)) {
      return 0;
    }
    var name = Cmd.string(context, PLAYER);
    var player = online(name);
    if (player.isEmpty()) {
      Say.error(sender, Say.MODERATION, name + " is not online.");
      return 0;
    }
    var target = player.orElseThrow();
    if (exempt(sender, target(target), EssentialsPermissions.KICK_EXEMPT)) {
      return 0;
    }
    var entry =
        AuditEntry.of(
            target.getUniqueId(),
            ModerationAction.KICK,
            actor(sender),
            AuditEntry.Term.permanent(reason, runtime.time().instant()));
    var targetName = target.getName();
    target.kick(BanMessages.kicked(reason));
    runtime.onMain(
        moderation.record(entry),
        "recording a kick",
        done -> staff(sender.getName() + " kicked " + targetName + ": " + reason),
        failure -> writeFailed(sender, "The kick happened but was not recorded"));
    return Cmd.OK;
  }

  private int ban(
      CommandContext<CommandSourceStack> context, Optional<Duration> length, String reason) {
    var sender = context.getSource().getSender();
    if (tooLong(sender, reason)) {
      return 0;
    }
    var target = resolve(sender, Cmd.string(context, PLAYER));
    if (target.isEmpty()
        || exempt(sender, target.orElseThrow(), EssentialsPermissions.BAN_EXEMPT)) {
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
    var ban = new Ban(reason, entry.actor(), now, entry.expiresAt());
    var term = length.map(l -> " for " + DurationText.format(l)).orElse(" permanently");
    runtime.onMain(
        moderation.record(entry),
        "recording a ban",
        done -> {
          var player = runtime.server().getPlayer(found.uuid());
          if (player != null) {
            player.kick(BanMessages.banned(ban, runtime.time().instant()));
          }
          staff(sender.getName() + " banned " + found.name() + term + ": " + reason);
        },
        failure -> writeFailed(sender, "The ban was NOT recorded and is not in force"));
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
    var target = resolve(sender, Cmd.string(context, PLAYER));
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
          runtime.onMain(
              moderation.record(entry),
              "recording an unban",
              done -> staff(sender.getName() + " unbanned " + found.name() + ": " + reason),
              failure -> writeFailed(sender, "The unban was NOT recorded; the ban stays"));
        },
        failure -> writeFailed(sender, "Could not read the ban list"));
    return Cmd.OK;
  }

  private int banlist(CommandContext<CommandSourceStack> context) {
    var sender = context.getSource().getSender();
    runtime.onMain(
        moderation.activeBans(),
        "listing bans",
        bans -> {
          if (bans.isEmpty()) {
            Say.info(sender, Say.MODERATION, "Nobody is banned.");
            return;
          }
          Say.info(sender, Say.MODERATION, bans.size() + " bans in force, newest first:");
          var now = runtime.time().instant();
          for (var active : bans) {
            var ban = active.ban();
            var ends =
                ban.remaining(now)
                    .map(left -> "ends in " + DurationText.format(left))
                    .orElse("permanent");
            Say.info(
                sender,
                Say.MODERATION,
                nameOf(active.player())
                    + " ("
                    + ends
                    + ", by "
                    + ban.actor().name()
                    + "): "
                    + ban.reason());
          }
        },
        failure -> writeFailed(sender, "Could not read the ban list"));
    return Cmd.OK;
  }

  private int history(CommandContext<CommandSourceStack> context) {
    var sender = context.getSource().getSender();
    var target = resolve(sender, Cmd.string(context, PLAYER));
    if (target.isEmpty()) {
      return 0;
    }
    var found = target.orElseThrow();
    runtime.onMain(
        moderation.history(found.uuid(), HISTORY_LIMIT),
        "loading moderation history",
        entries -> showHistory(sender, found.name(), entries),
        failure -> writeFailed(sender, "Could not read the moderation log"));
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

  /** A player by name (online, then last-known) or by UUID. Tells the sender if unknown. */
  private Optional<Target> resolve(CommandSender sender, String input) {
    var id = parseUuid(input);
    if (id.isPresent()) {
      var uuid = id.orElseThrow();
      var player = Optional.ofNullable(runtime.server().getPlayer(uuid));
      var name = player.map(Player::getName).or(() -> players.name(uuid)).orElse(input);
      return Optional.of(new Target(uuid, name, player));
    }
    var online = online(input);
    if (online.isPresent()) {
      return online.map(this::target);
    }
    var known = players.find(input);
    if (known.isEmpty()) {
      Say.error(sender, Say.MODERATION, "No player called " + input + " has joined The Storm.");
      return Optional.empty();
    }
    var player = known.orElseThrow();
    return Optional.of(new Target(player.uuid(), player.name(), Optional.empty()));
  }

  private Target target(Player player) {
    return new Target(player.getUniqueId(), player.getName(), Optional.of(player));
  }

  private Optional<Player> online(String name) {
    return Optional.ofNullable(runtime.server().getPlayerExact(name));
  }

  /** Refuses (and says why) when the target is exempt, or offline and the sender is not console. */
  private static boolean exempt(CommandSender sender, Target target, String exemption) {
    var who = sender instanceof Player ? Exemption.Sender.PLAYER : Exemption.Sender.CONSOLE;
    Exemption.Target state =
        target
            .online()
            .<Exemption.Target>map(p -> new Exemption.Target.Online(p.hasPermission(exemption)))
            .orElseGet(Exemption.Target.Offline::new);
    var refusal = Exemption.refusal(who, state);
    refusal.ifPresent(message -> Say.error(sender, Say.MODERATION, message));
    return refusal.isPresent();
  }

  private String nameOf(UUID player) {
    return players.name(player).orElseGet(player::toString);
  }

  private static Optional<UUID> parseUuid(String input) {
    if (input.length() != 36) {
      return Optional.empty();
    }
    try {
      return Optional.of(UUID.fromString(input));
    } catch (IllegalArgumentException e) {
      return Optional.empty();
    }
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

  private void writeFailed(CommandSender sender, String what) {
    Say.error(sender, Say.MODERATION, what + " (moderation log error; see the server log).");
  }

  private void staff(String message) {
    runtime.server().getOnlinePlayers().stream()
        .filter(player -> player.hasPermission(EssentialsPermissions.KICK))
        .forEach(player -> Say.info(player, Say.MODERATION, message));
    Say.info(runtime.server().getConsoleSender(), Say.MODERATION, message);
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
