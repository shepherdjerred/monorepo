package com.shepherdjerred.thestorm.tracks.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.builder.RequiredArgumentBuilder;
import com.mojang.brigadier.suggestion.Suggestions;
import com.mojang.brigadier.suggestion.SuggestionsBuilder;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.tracks.app.Purchase;
import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.app.Quote;
import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.domain.Confirmations;
import com.shepherdjerred.thestorm.tracks.domain.TrackIds;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import com.shepherdjerred.thestorm.tracks.domain.Wording;
import com.shepherdjerred.thestorm.tracks.domain.purchase.TrackStanding;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/**
 * {@code /perks}: every track's level and next price, {@code /perks buy <track>} (run twice to
 * confirm) and {@code /perks info <track>}. The administrators' {@code /perks admin} lives in
 * {@link PerksAdminCommands}.
 */
final class PerksCommands {

  static final String TRACK = "track";

  private final UseCases useCases;
  private final Presenter presenter;
  private final Paper paper;
  private final PerksAdminCommands admin;
  private final Confirmations<UUID, Quote> pendingBuys;

  PerksCommands(UseCases useCases, Presenter presenter, Paper paper) {
    this.useCases = useCases;
    this.presenter = presenter;
    this.paper = paper;
    this.admin = new PerksAdminCommands(useCases, presenter, paper);
    this.pendingBuys = new Confirmations<>(paper.confirmWindow());
  }

  void register(Commands commands) {
    commands.register(perks(), "Shows and buys track levels");
  }

  /** Drops {@code player}'s open confirmation when they leave. */
  void forget(UUID player) {
    pendingBuys.forget(player);
  }

  private LiteralCommandNode<CommandSourceStack> perks() {
    return Commands.literal("perks")
        .executes(context -> overview(context.getSource().getSender()))
        .then(
            Commands.literal("buy")
                .then(
                    trackArgument()
                        .executes(
                            context ->
                                buy(context.getSource().getSender(), getString(context, TRACK)))))
        .then(
            Commands.literal("info")
                .then(
                    trackArgument()
                        .executes(
                            context ->
                                info(context.getSource().getSender(), getString(context, TRACK)))))
        .then(admin.node())
        .build();
  }

  static RequiredArgumentBuilder<CommandSourceStack, String> trackArgument() {
    return Commands.argument(TRACK, word()).suggests((context, builder) -> suggestTracks(builder));
  }

  private static CompletableFuture<Suggestions> suggestTracks(SuggestionsBuilder builder) {
    var prefix = builder.getRemainingLowerCase();
    TrackIds.all().stream().filter(id -> id.startsWith(prefix)).forEach(builder::suggest);
    return builder.buildFuture();
  }

  /** The track named {@code id}, or tells {@code sender} it does not exist. */
  static Optional<Track> track(CommandSender sender, String id) {
    var track = TrackIds.parse(id);
    if (track.isEmpty()) {
      sender.sendMessage(
          Replies.error(
              "There is no track called " + id + ". Tracks: " + String.join(", ", TrackIds.all())));
    }
    return track;
  }

  private int overview(CommandSender sender) {
    if (!(sender instanceof Player player)) {
      sender.sendMessage(Replies.error("Only players have tracks; try /perks info <track>."));
      return Command.SINGLE_SUCCESS;
    }
    paper
        .replies()
        .whenDone(
            useCases.purchases().overview(player.getUniqueId()),
            sender,
            result -> {
              var now = paper.time().instant();
              switch (result) {
                case Result.Ok<List<TrackStanding>, PurchaseProblem>(var standings) ->
                    presenter.overview(standings, now).forEach(sender::sendMessage);
                case Result.Err<List<TrackStanding>, PurchaseProblem>(var problem) ->
                    sender.sendMessage(
                        Replies.error(presenter.explanations().explain(problem, now)));
              }
            });
    return Command.SINGLE_SUCCESS;
  }

  private int info(CommandSender sender, String id) {
    track(sender, id)
        .ifPresent(
            track -> {
              var owned =
                  sender instanceof Player player
                      ? useCases.cache().level(player.getUniqueId(), track)
                      : 0;
              presenter.info(track, owned).forEach(sender::sendMessage);
            });
    return Command.SINGLE_SUCCESS;
  }

  private int buy(CommandSender sender, String id) {
    if (!(sender instanceof Player player)) {
      sender.sendMessage(Replies.error("Only players can train tracks."));
      return Command.SINGLE_SUCCESS;
    }
    track(sender, id).ifPresent(track -> buy(player, track));
    return Command.SINGLE_SUCCESS;
  }

  private void buy(Player player, Track track) {
    var uuid = player.getUniqueId();
    var confirmed =
        pendingBuys.confirm(uuid, quote -> quote.track() == track, paper.time().instant());
    if (confirmed.isPresent()) {
      paper
          .replies()
          .whenDone(
              useCases.purchases().buy(uuid, confirmed.get()),
              player,
              result -> bought(player, result));
      return;
    }
    paper
        .replies()
        .whenDone(
            useCases.purchases().quote(uuid, track),
            player,
            result -> {
              switch (result) {
                case Result.Ok<Quote, List<PurchaseProblem>>(var quote) -> offer(player, quote);
                case Result.Err<Quote, List<PurchaseProblem>>(var problems) ->
                    explain(player, problems);
              }
            });
  }

  private void offer(Player player, Quote quote) {
    pendingBuys.offer(player.getUniqueId(), quote, paper.time().instant());
    var primaryNote =
        useCases.cache().progress(player.getUniqueId()).flatMap(TrackProgress::primary).isEmpty()
            ? " It will be your primary track: no other track can pass its level."
            : "";
    player.sendMessage(
        Replies.info(
            "Train "
                + presenter.explanations().offer(quote)
                + "?"
                + primaryNote
                + " Run /perks buy "
                + quote.track().id()
                + " again within "
                + Wording.wait(paper.confirmWindow())
                + " to confirm."));
  }

  private void bought(Player player, Result<Purchase, List<PurchaseProblem>> result) {
    switch (result) {
      case Result.Ok<Purchase, List<PurchaseProblem>>(var purchase) -> {
        player.sendMessage(
            Replies.success(
                "You trained " + presenter.explanations().offer(purchase.quote()) + "."));
        if (purchase.primary()) {
          player.sendMessage(
              Replies.info(
                  presenter.explanations().name(purchase.quote().track())
                      + " is now your primary track."));
        }
      }
      case Result.Err<Purchase, List<PurchaseProblem>>(var problems) -> explain(player, problems);
    }
  }

  private void explain(CommandSender sender, List<PurchaseProblem> problems) {
    var now = paper.time().instant();
    for (var problem : problems) {
      sender.sendMessage(Replies.error(presenter.explanations().explain(problem, now)));
    }
  }
}
