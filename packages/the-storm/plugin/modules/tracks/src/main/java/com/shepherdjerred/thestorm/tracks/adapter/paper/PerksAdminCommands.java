package com.shepherdjerred.thestorm.tracks.adapter.paper;

import static com.mojang.brigadier.arguments.IntegerArgumentType.getInteger;
import static com.mojang.brigadier.arguments.IntegerArgumentType.integer;
import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.builder.RequiredArgumentBuilder;
import com.mojang.brigadier.suggestion.Suggestions;
import com.mojang.brigadier.suggestion.SuggestionsBuilder;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.domain.AdminProblem;
import com.shepherdjerred.thestorm.tracks.domain.Confirmations;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import com.shepherdjerred.thestorm.tracks.domain.Wording;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import org.bukkit.command.CommandSender;

/**
 * {@code /perks admin set <player> <track> <level>} and {@code /perks admin reset <player>} (run
 * twice to confirm). Both work on anyone who has ever joined, online or not, charge nothing and
 * refund nothing.
 */
final class PerksAdminCommands {

  static final String ADMIN_PERMISSION = "thestorm.tracks.admin";

  private static final String PLAYER = "player";
  private static final String LEVEL = "level";

  private final UseCases useCases;
  private final Presenter presenter;
  private final Paper paper;
  private final Confirmations<String, UUID> pendingResets;

  PerksAdminCommands(UseCases useCases, Presenter presenter, Paper paper) {
    this.useCases = useCases;
    this.presenter = presenter;
    this.paper = paper;
    this.pendingResets = new Confirmations<>(paper.confirmWindow());
  }

  /**
   * One player an administrator named.
   *
   * @param uuid their id
   * @param name their name as Paper knows it
   */
  private record Target(UUID uuid, String name) {}

  LiteralArgumentBuilder<CommandSourceStack> node() {
    return Commands.literal("admin")
        .requires(source -> source.getSender().hasPermission(ADMIN_PERMISSION))
        .then(
            Commands.literal("set")
                .then(
                    playerArgument()
                        .then(
                            PerksCommands.trackArgument()
                                .then(
                                    Commands.argument(LEVEL, integer(0, Track.MAX_LEVEL))
                                        .executes(
                                            context ->
                                                set(
                                                    context.getSource().getSender(),
                                                    getString(context, PLAYER),
                                                    getString(context, PerksCommands.TRACK),
                                                    getInteger(context, LEVEL)))))))
        .then(
            Commands.literal("reset")
                .then(
                    playerArgument()
                        .executes(
                            context ->
                                reset(
                                    context.getSource().getSender(), getString(context, PLAYER)))));
  }

  private RequiredArgumentBuilder<CommandSourceStack, String> playerArgument() {
    return Commands.argument(PLAYER, word()).suggests((context, builder) -> suggest(builder));
  }

  private CompletableFuture<Suggestions> suggest(SuggestionsBuilder builder) {
    var prefix = builder.getRemainingLowerCase();
    for (var player : paper.server().getOnlinePlayers()) {
      if (player.getName().toLowerCase(Locale.ROOT).startsWith(prefix)) {
        builder.suggest(player.getName());
      }
    }
    return builder.buildFuture();
  }

  private int set(CommandSender admin, String name, String trackId, int level) {
    PerksCommands.track(admin, trackId)
        .ifPresent(track -> withTarget(admin, name, target -> set(admin, target, track, level)));
    return Command.SINGLE_SUCCESS;
  }

  private void set(CommandSender admin, Target who, Track track, int level) {
    paper
        .replies()
        .whenDone(
            useCases.admin().set(who.uuid(), track, level),
            admin,
            result -> {
              switch (result) {
                case Result.Ok<TrackProgress, AdminProblem>(var _) -> {
                  var described = level == 0 ? "untrained" : Wording.numeral(level);
                  var trackName = presenter.explanations().name(track);
                  admin.sendMessage(
                      Replies.success(
                          "Set " + who.name() + "'s " + trackName + " to " + described + "."));
                  tell(
                      who,
                      Replies.info("An admin set your " + trackName + " to " + described + "."));
                }
                case Result.Err<TrackProgress, AdminProblem>(var problem) ->
                    admin.sendMessage(Replies.error(presenter.explanations().explain(problem)));
              }
            });
  }

  private int reset(CommandSender admin, String name) {
    withTarget(admin, name, target -> reset(admin, target));
    return Command.SINGLE_SUCCESS;
  }

  private void reset(CommandSender admin, Target target) {
    var now = paper.time().instant();
    var confirmed = pendingResets.confirm(admin.getName(), target.uuid()::equals, now);
    if (confirmed.isEmpty()) {
      pendingResets.offer(admin.getName(), target.uuid(), now);
      admin.sendMessage(
          Replies.info(
              "This clears every track level and the primary track of "
                  + target.name()
                  + ", with no refund. Run /perks admin reset "
                  + target.name()
                  + " again within "
                  + Wording.wait(paper.confirmWindow())
                  + " to confirm."));
      return;
    }
    paper
        .replies()
        .whenDone(
            useCases.admin().reset(target.uuid()),
            admin,
            progress -> {
              admin.sendMessage(Replies.success("Reset " + target.name() + "'s tracks."));
              tell(
                  target,
                  Replies.info(
                      "An admin reset your tracks; buy a new primary track with /perks buy."));
            });
  }

  /**
   * Runs {@code action} on the player called {@code name}: an online player at once, otherwise
   * anyone who has ever joined, looked up in the player directory off the main thread. Tells {@code
   * admin} when nobody by that name has played.
   */
  private void withTarget(CommandSender admin, String name, Consumer<Target> action) {
    var online = paper.server().getPlayerExact(name);
    if (online != null) {
      action.accept(new Target(online.getUniqueId(), online.getName()));
      return;
    }
    paper
        .replies()
        .whenDone(
            paper.players().byName(name),
            admin,
            found ->
                found.ifPresentOrElse(
                    known -> action.accept(new Target(known.uuid(), known.lastName())),
                    () ->
                        admin.sendMessage(
                            Replies.error("Nobody named " + name + " has played on The Storm."))));
  }

  private void tell(Target target, Component message) {
    var online = paper.server().getPlayer(target.uuid());
    if (online != null) {
      online.sendMessage(message);
    }
  }
}
