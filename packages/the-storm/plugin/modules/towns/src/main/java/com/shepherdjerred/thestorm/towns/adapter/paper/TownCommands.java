package com.shepherdjerred.thestorm.towns.adapter.paper;

import static com.mojang.brigadier.arguments.BoolArgumentType.bool;
import static com.mojang.brigadier.arguments.BoolArgumentType.getBool;
import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.suggestion.Suggestions;
import com.mojang.brigadier.suggestion.SuggestionsBuilder;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.towns.app.Change;
import com.shepherdjerred.thestorm.towns.app.TownService;
import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.app.Treasury;
import com.shepherdjerred.thestorm.towns.domain.Explanations;
import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimProblem;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownProblem;
import com.shepherdjerred.thestorm.tracks.app.Track;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import java.util.function.Function;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.entity.Player;

/**
 * {@code /town create|delete|rename|info|list} (with the membership and treasury subcommands of
 * {@link MemberCommands} and {@link TreasuryCommands}), {@code /claim}, {@code /claim
 * info|flag|trust|untrust} and {@code /unclaim}. Changes apply at once; the player hears back once
 * they are saved, or that they were undone if saving failed.
 */
final class TownCommands {

  static final String NAME = "name";
  static final String PLAYER = "player";
  private static final String FLAG = "flag";
  private static final String VALUE = "value";

  private final TownService towns;
  private final TownsState state;
  private final Parts parts;

  /**
   * The main-thread services the commands use.
   *
   * @param scheduler completes saves back onto the main thread
   * @param logger records failed saves
   */
  record Services(Scheduler scheduler, ComponentLogger logger) {

    /** Tells {@code player} {@code success} once {@code saved} completes, or that it was undone. */
    void whenSaved(Player player, CompletableFuture<Void> saved, Component success) {
      var _ =
          saved.whenCompleteAsync(
              (ok, failure) -> {
                if (failure != null) {
                  logger.error("Saving a towns change failed; it was undone", failure);
                  player.sendMessage(
                      Notices.error("That could not be saved, so it was undone. Try again."));
                  return;
                }
                player.sendMessage(success);
              },
              scheduler.mainThread());
    }

    /**
     * Reports a town change: problems at once; success once saved. The success message is built
     * now, while every town it names certainly exists, and only sent later.
     */
    void report(
        Player player,
        Result<Change<Town>, List<TownProblem>> result,
        Function<Town, Component> message) {
      switch (result) {
        case Result.Ok<Change<Town>, List<TownProblem>>(var change) ->
            whenSaved(player, change.saved(), message.apply(change.value()));
        case Result.Err<Change<Town>, List<TownProblem>>(var problems) -> refuse(player, problems);
      }
    }

    void refuse(Player player, List<TownProblem> problems) {
      problems.forEach(problem -> player.sendMessage(Notices.error(Explanations.explain(problem))));
    }
  }

  /**
   * What the commands use besides the towns themselves.
   *
   * @param members membership subcommands
   * @param treasuryCommands treasury subcommands
   * @param treasury pays out a deleted town's treasury
   * @param levels players' Governor levels
   * @param runtime reports saves
   */
  record Parts(
      MemberCommands members,
      TreasuryCommands treasuryCommands,
      Treasury treasury,
      GovernorLevels levels,
      Services runtime) {}

  TownCommands(TownService towns, TownsState state, Parts parts) {
    this.towns = towns;
    this.state = state;
    this.parts = parts;
  }

  void register(Commands commands) {
    commands.register(town(), "Founds, runs, shows or deletes your town");
    commands.register(claim(), "Claims the chunk you stand in for your town");
    commands.register(unclaim(), "Gives up the chunk you stand in");
  }

  private LiteralCommandNode<CommandSourceStack> town() {
    LiteralArgumentBuilder<CommandSourceStack> town =
        Commands.literal("town")
            .executes(context -> asPlayer(context, this::showTown))
            .then(
                Commands.literal("create")
                    .then(
                        Commands.argument(NAME, word())
                            .executes(
                                context ->
                                    asPlayer(
                                        context,
                                        player -> found(player, getString(context, NAME))))))
            .then(
                Commands.literal("delete")
                    .executes(context -> asPlayer(context, player -> delete(player, "")))
                    .then(
                        Commands.argument(NAME, word())
                            .executes(
                                context ->
                                    asPlayer(
                                        context,
                                        player -> delete(player, getString(context, NAME))))));
    parts.members().attach(town);
    parts.treasuryCommands().attach(town);
    return town.build();
  }

  private LiteralCommandNode<CommandSourceStack> claim() {
    return Commands.literal("claim")
        .executes(context -> asPlayer(context, this::claimHere))
        .then(Commands.literal("info").executes(context -> asPlayer(context, this::describeHere)))
        .then(
            Commands.literal("flag")
                .then(
                    Commands.argument(FLAG, word())
                        .suggests(
                            (context, builder) -> {
                              Arrays.stream(ClaimFlag.values())
                                  .map(Explanations::flagName)
                                  .filter(name -> name.startsWith(builder.getRemainingLowerCase()))
                                  .forEach(builder::suggest);
                              return builder.buildFuture();
                            })
                        .then(
                            Commands.argument(VALUE, bool())
                                .executes(
                                    context ->
                                        asPlayer(
                                            context,
                                            player ->
                                                setFlag(
                                                    player,
                                                    getString(context, FLAG),
                                                    getBool(context, VALUE)))))))
        .then(trustCommand("trust", true))
        .then(trustCommand("untrust", false))
        .build();
  }

  private LiteralArgumentBuilder<CommandSourceStack> trustCommand(String literal, boolean on) {
    return Commands.literal(literal)
        .then(
            Commands.argument(PLAYER, word())
                .suggests(TownCommands::suggestOnline)
                .executes(
                    context ->
                        asPlayer(
                            context, player -> trustHere(player, getString(context, PLAYER), on))));
  }

  private LiteralCommandNode<CommandSourceStack> unclaim() {
    return Commands.literal("unclaim")
        .executes(context -> asPlayer(context, this::unclaimHere))
        .build();
  }

  private void showTown(Player player) {
    var town = state.townOf(player.getUniqueId());
    if (town.isEmpty()) {
      player.sendMessage(
          Notices.info("You are not in a town. Found one with /town create <name>."));
      return;
    }
    parts.members().info(player, town.get());
  }

  /** Founds a town; needs Governor I. */
  void found(Player player, String name) {
    if (!player.hasPermission(Track.GOVERNOR.permission(1))) {
      player.sendMessage(
          Notices.error(
              "Founding a town takes Governor I. Train it with the Governor trainer or /perks."));
      return;
    }
    var level = parts.levels().of(player);
    onTown(
        player,
        towns.found(player.getUniqueId(), name, level),
        town ->
            Notices.success(
                "Founded " + town.name() + ". Stand in a chunk and type /claim to claim it."));
  }

  /** Deletes the player's town, then pays its durably queued treasury to them. */
  void delete(Player player, String confirmation) {
    var claims = state.townOf(player.getUniqueId()).map(town -> state.claimCount(town.id()));
    var _ =
        parts
            .treasury()
            .delete(player.getUniqueId(), confirmation)
            .whenComplete(
                (result, failure) -> {
                  if (failure != null) {
                    parts.runtime().logger().error("Deleting a town failed", failure);
                    player.sendMessage(Notices.error("The town could not be deleted; try again."));
                    return;
                  }
                  switch (result) {
                    case Result.Err<Change<Town>, List<TownProblem>>(var problems) ->
                        parts.runtime().refuse(player, problems);
                    case Result.Ok<Change<Town>, List<TownProblem>>(var change) -> {
                      var _ =
                          change
                              .saved()
                              .whenCompleteAsync(
                                  (ignored, saveFailure) -> {
                                    if (saveFailure != null) {
                                      parts
                                          .runtime()
                                          .logger()
                                          .error("Deleting a town failed", saveFailure);
                                      player.sendMessage(
                                          Notices.error(
                                              payoutPending(saveFailure)
                                                  ? "The town was deleted, but its treasury payout is pending recovery."
                                                  : "The town could not be saved, so it was kept. Try again."));
                                      return;
                                    }
                                    player.sendMessage(
                                        Notices.success(
                                            "Deleted "
                                                + change.value().name()
                                                + " and released its "
                                                + claims.orElse(0)
                                                + " chunk(s). Its treasury is yours."));
                                  },
                                  parts.runtime().scheduler().mainThread());
                    }
                  }
                });
  }

  private static boolean payoutPending(Throwable failure) {
    for (var cause = failure; cause != null; cause = cause.getCause()) {
      if (cause instanceof Treasury.PayoutPending) {
        return true;
      }
    }
    return false;
  }

  private void claimHere(Player player) {
    var chunk = chunkOf(player);
    onClaim(
        player,
        towns.claim(player.getUniqueId(), chunk),
        claim ->
            Notices.success(
                "Claimed chunk " + chunk.x() + ", " + chunk.z() + " for " + nameOf(claim) + "."));
  }

  private void unclaimHere(Player player) {
    var chunk = chunkOf(player);
    onClaim(
        player,
        towns.unclaim(player.getUniqueId(), chunk),
        claim -> Notices.success("Released chunk " + chunk.x() + ", " + chunk.z() + "."));
  }

  private void setFlag(Player player, String flagName, boolean on) {
    var flag =
        Arrays.stream(ClaimFlag.values())
            .filter(candidate -> Explanations.flagName(candidate).equals(flagName))
            .findFirst();
    if (flag.isEmpty()) {
      player.sendMessage(
          Notices.error(
              "Unknown flag "
                  + flagName
                  + ". Flags: "
                  + String.join(
                      ", ", Arrays.stream(ClaimFlag.values()).map(Explanations::flagName).toList())
                  + "."));
      return;
    }
    onClaim(
        player,
        towns.setFlag(player.getUniqueId(), chunkOf(player), flag.get(), on),
        claim ->
            Notices.success(
                Explanations.flagName(flag.get())
                    + " is now "
                    + (on ? "on" : "off")
                    + " here. "
                    + Explanations.describe(claim.flags())
                    + "."));
  }

  /** Trusts (or stops trusting) the named player on the chunk {@code player} stands in. */
  void trustHere(Player player, String name, boolean on) {
    var chunk = chunkOf(player);
    parts
        .members()
        .names()
        .resolve(
            player,
            name,
            target ->
                onClaim(
                    player,
                    towns.trust(player.getUniqueId(), chunk, target, on),
                    claim ->
                        Notices.success(
                            on
                                ? target.name()
                                    + " may now build, open containers and use switches on this"
                                    + " chunk."
                                : target.name() + " is no longer trusted on this chunk.")));
  }

  private void describeHere(Player player) {
    var location = Guard.position(player);
    var land =
        state.landAt(
            Guard.world(location).getName(),
            location.getBlockX(),
            location.getBlockY(),
            location.getBlockZ());
    player.sendMessage(Notices.info(describe(land)));
  }

  private String describe(Land land) {
    return switch (land) {
      case Land.Wilderness _ -> "This is wilderness; anyone may build here.";
      case Land.TownLand(var claim) ->
          "This chunk belongs to "
              + nameOf(claim)
              + ". Flags: "
              + Explanations.describe(claim.flags())
              + "."
              + (claim.trusted().isEmpty()
                  ? ""
                  : " " + claim.trusted().size() + " outsider(s) are trusted here.");
      case Land.RegionLand(var region) ->
          "This is " + region.name() + ", an admin region; it cannot be claimed.";
    };
  }

  private String nameOf(Claim claim) {
    return townName(claim.townId());
  }

  /** A town's name, looked up while handling a command, when every claim's town exists. */
  private String townName(UUID townId) {
    return state
        .town(townId)
        .map(Town::name)
        .orElseThrow(() -> new IllegalStateException("no town " + townId + " holds a claim"));
  }

  static ChunkPos chunkOf(Player player) {
    var location = Guard.position(player);
    return ChunkPos.ofBlock(
        Guard.world(location).getName(), location.getBlockX(), location.getBlockZ());
  }

  private void onTown(
      Player player,
      Result<Change<Town>, List<TownProblem>> result,
      Function<Town, Component> message) {
    parts.runtime().report(player, result, message);
  }

  private void onClaim(
      Player player,
      Result<Change<Claim>, List<ClaimProblem>> result,
      Function<Claim, Component> message) {
    switch (result) {
      case Result.Ok<Change<Claim>, List<ClaimProblem>>(var change) ->
          parts.runtime().whenSaved(player, change.saved(), message.apply(change.value()));
      case Result.Err<Change<Claim>, List<ClaimProblem>>(var problems) ->
          problems.forEach(
              problem ->
                  player.sendMessage(Notices.error(Explanations.explain(problem, this::townName))));
    }
  }

  static int asPlayer(CommandContext<CommandSourceStack> context, Consumer<Player> action) {
    if (context.getSource().getSender() instanceof Player player) {
      action.accept(player);
    } else {
      context.getSource().getSender().sendMessage(Notices.error("Only players can do that."));
    }
    return Command.SINGLE_SUCCESS;
  }

  /** Suggests the names of online players. */
  static CompletableFuture<Suggestions> suggestOnline(
      CommandContext<CommandSourceStack> context, SuggestionsBuilder builder) {
    var server = context.getSource().getSender().getServer();
    server.getOnlinePlayers().stream()
        .map(Player::getName)
        .filter(name -> name.toLowerCase(Locale.ROOT).startsWith(builder.getRemainingLowerCase()))
        .forEach(builder::suggest);
    return builder.buildFuture();
  }
}
