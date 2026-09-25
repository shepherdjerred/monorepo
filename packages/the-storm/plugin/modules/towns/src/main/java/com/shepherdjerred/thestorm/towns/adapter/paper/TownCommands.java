package com.shepherdjerred.thestorm.towns.adapter.paper;

import static com.mojang.brigadier.arguments.BoolArgumentType.bool;
import static com.mojang.brigadier.arguments.BoolArgumentType.getBool;
import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.towns.app.Change;
import com.shepherdjerred.thestorm.towns.app.TownService;
import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.domain.Explanations;
import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimProblem;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownProblem;
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
 * {@code /town create|delete}, {@code /claim}, {@code /claim info}, {@code /claim flag} and {@code
 * /unclaim}. Changes apply at once; the player hears back once they are saved, or that they were
 * undone if saving failed.
 */
final class TownCommands {

  private static final String NAME = "name";
  private static final String FLAG = "flag";
  private static final String VALUE = "value";

  private final TownService towns;
  private final TownsState state;
  private final Services runtime;

  /**
   * The main-thread services the commands use.
   *
   * @param scheduler completes saves back onto the main thread
   * @param logger records failed saves
   */
  record Services(Scheduler scheduler, ComponentLogger logger) {}

  TownCommands(TownService towns, TownsState state, Services runtime) {
    this.towns = towns;
    this.state = state;
    this.runtime = runtime;
  }

  void register(Commands commands) {
    commands.register(town(), "Founds, shows or deletes your town");
    commands.register(claim(), "Claims the chunk you stand in for your town");
    commands.register(unclaim(), "Gives up the chunk you stand in");
  }

  private LiteralCommandNode<CommandSourceStack> town() {
    return Commands.literal("town")
        .executes(context -> asPlayer(context, this::showTown))
        .then(
            Commands.literal("create")
                .then(
                    Commands.argument(NAME, word())
                        .executes(
                            context ->
                                asPlayer(
                                    context, player -> found(player, getString(context, NAME))))))
        .then(
            Commands.literal("delete")
                .executes(context -> asPlayer(context, player -> disband(player, "")))
                .then(
                    Commands.argument(NAME, word())
                        .executes(
                            context ->
                                asPlayer(
                                    context, player -> disband(player, getString(context, NAME))))))
        .build();
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
        .build();
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
    var found = town.get();
    var role = found.roleOf(player.getUniqueId()).orElseThrow();
    player.sendMessage(
        Notices.info(
            found.name()
                + ": you are its "
                + role.name().toLowerCase(Locale.ROOT)
                + "; "
                + found.members().size()
                + " member(s), "
                + state.claimCount(found.id())
                + " chunk(s)."));
  }

  private void found(Player player, String name) {
    onTown(
        player,
        towns.found(player.getUniqueId(), name),
        town ->
            Notices.success(
                "Founded " + town.name() + ". Stand in a chunk and type /claim to claim it."));
  }

  private void disband(Player player, String confirmation) {
    var claims = state.townOf(player.getUniqueId()).map(town -> state.claimCount(town.id()));
    onTown(
        player,
        towns.disband(player.getUniqueId(), confirmation),
        town ->
            Notices.success(
                "Deleted " + town.name() + " and released its " + claims.orElse(0) + " chunk(s)."));
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
              + ".";
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

  private static ChunkPos chunkOf(Player player) {
    var location = Guard.position(player);
    return ChunkPos.ofBlock(
        Guard.world(location).getName(), location.getBlockX(), location.getBlockZ());
  }

  /**
   * Reports a town change: problems at once; success once saved. The success message is built now,
   * while every town it names certainly exists, and only sent later.
   */
  private void onTown(
      Player player,
      Result<Change<Town>, List<TownProblem>> result,
      Function<Town, Component> message) {
    switch (result) {
      case Result.Ok<Change<Town>, List<TownProblem>>(var change) ->
          whenSaved(player, change.saved(), message.apply(change.value()));
      case Result.Err<Change<Town>, List<TownProblem>>(var problems) ->
          problems.forEach(
              problem -> player.sendMessage(Notices.error(Explanations.explain(problem))));
    }
  }

  private void onClaim(
      Player player,
      Result<Change<Claim>, List<ClaimProblem>> result,
      Function<Claim, Component> message) {
    switch (result) {
      case Result.Ok<Change<Claim>, List<ClaimProblem>>(var change) ->
          whenSaved(player, change.saved(), message.apply(change.value()));
      case Result.Err<Change<Claim>, List<ClaimProblem>>(var problems) ->
          problems.forEach(
              problem ->
                  player.sendMessage(Notices.error(Explanations.explain(problem, this::townName))));
    }
  }

  private void whenSaved(Player player, CompletableFuture<Void> saved, Component success) {
    var _ =
        saved.whenCompleteAsync(
            (ok, failure) -> {
              if (failure != null) {
                runtime.logger().error("Saving a towns change failed; it was undone", failure);
                player.sendMessage(
                    Notices.error("That could not be saved, so it was undone. Try again."));
                return;
              }
              player.sendMessage(success);
            },
            runtime.scheduler().mainThread());
  }

  private static int asPlayer(CommandContext<CommandSourceStack> context, Consumer<Player> action) {
    if (context.getSource().getSender() instanceof Player player) {
      action.accept(player);
    } else {
      context.getSource().getSender().sendMessage(Notices.error("Only players can do that."));
    }
    return Command.SINGLE_SUCCESS;
  }
}
