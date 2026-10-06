package com.shepherdjerred.thestorm.towns.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;
import static java.util.Objects.requireNonNull;
import static java.util.stream.Collectors.joining;

import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.suggestion.Suggestions;
import com.mojang.brigadier.suggestion.SuggestionsBuilder;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.app.Change;
import com.shepherdjerred.thestorm.towns.app.MembershipService;
import com.shepherdjerred.thestorm.towns.app.TownService;
import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.domain.Explanations;
import com.shepherdjerred.thestorm.towns.domain.town.PlayerRef;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownProblem;
import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.BiConsumer;
import net.kyori.adventure.text.Component;
import org.bukkit.Server;
import org.bukkit.entity.Player;

/**
 * {@code /town invite|accept|deny|leave|kick|promote|demote|transfer|rename|info|list}. Players
 * named in a command may be offline; they are found by name through core's player directory.
 */
final class MemberCommands {

  private static final String TOWN = "town";

  private final MembershipService members;
  private final TownService towns;
  private final Names names;
  private final TownCommands.Services runtime;

  MemberCommands(
      MembershipService members, TownService towns, Names names, TownCommands.Services runtime) {
    this.members = members;
    this.towns = towns;
    this.names = names;
    this.runtime = runtime;
  }

  Names names() {
    return names;
  }

  /** Adds the membership subcommands to {@code /town}. */
  void attach(LiteralArgumentBuilder<CommandSourceStack> town) {
    town.then(named("invite", this::invite))
        .then(townNamed("accept", this::accept))
        .then(townNamed("deny", this::deny))
        .then(
            Commands.literal("leave")
                .executes(context -> TownCommands.asPlayer(context, this::leave)))
        .then(named("kick", this::kick))
        .then(named("promote", this::promote))
        .then(named("demote", this::demote))
        .then(
            named("transfer", this::requestTransfer)
                .then(
                    Commands.literal("confirm")
                        .executes(
                            context -> TownCommands.asPlayer(context, this::confirmTransfer))))
        .then(
            Commands.literal("rename")
                .then(
                    Commands.argument(TownCommands.NAME, word())
                        .executes(
                            context ->
                                TownCommands.asPlayer(
                                    context,
                                    player ->
                                        rename(player, getString(context, TownCommands.NAME))))))
        .then(
            Commands.literal("info")
                .executes(context -> TownCommands.asPlayer(context, this::infoOwn)));
  }

  /** {@code /town <literal> <player>}, running {@code action} once the player is found. */
  private LiteralArgumentBuilder<CommandSourceStack> named(
      String literal, BiConsumer<Player, PlayerRef> action) {
    return Commands.literal(literal)
        .then(
            Commands.argument(TownCommands.PLAYER, word())
                .suggests(TownCommands::suggestOnline)
                .executes(
                    context ->
                        TownCommands.asPlayer(
                            context,
                            player ->
                                names.resolve(
                                    player,
                                    getString(context, TownCommands.PLAYER),
                                    target -> action.accept(player, target)))));
  }

  /** {@code /town <literal> <town>}. */
  private LiteralArgumentBuilder<CommandSourceStack> townNamed(
      String literal, BiConsumer<Player, String> action) {
    return Commands.literal(literal)
        .then(
            Commands.argument(TOWN, word())
                .suggests(this::suggestInvitations)
                .executes(
                    context ->
                        TownCommands.asPlayer(
                            context, player -> action.accept(player, getString(context, TOWN)))));
  }

  void invite(Player player, PlayerRef target) {
    switch (members.invite(player.getUniqueId(), target)) {
      case Result.Ok<Town, List<TownProblem>>(var town) -> {
        player.sendMessage(
            Notices.success("Invited " + target.name() + " to " + town.name() + "."));
        tell(
            target.id(),
            Notices.info(
                player.getName()
                    + " invited you to "
                    + town.name()
                    + ". Type /town accept "
                    + town.name()
                    + " to join or /town deny "
                    + town.name()
                    + "."));
      }
      case Result.Err<Town, List<TownProblem>>(var problems) -> runtime.refuse(player, problems);
    }
  }

  void accept(Player player, String townName) {
    var result = members.accept(player.getUniqueId(), townName);
    runtime.report(player, result, town -> Notices.success("You joined " + town.name() + "."));
    if (result instanceof Result.Ok<Change<Town>, List<TownProblem>>(var change)) {
      afterSaved(
          change,
          () ->
              tellTown(
                  change.value(), player, Notices.info(player.getName() + " joined the town.")));
    }
  }

  void deny(Player player, String townName) {
    switch (members.deny(player.getUniqueId(), townName)) {
      case Result.Ok<Town, List<TownProblem>>(var town) -> {
        player.sendMessage(Notices.info("You turned down " + town.name() + "."));
        tellTown(town, player, Notices.info(player.getName() + " turned down the invitation."));
      }
      case Result.Err<Town, List<TownProblem>>(var problems) -> runtime.refuse(player, problems);
    }
  }

  private void leave(Player player) {
    var result = members.leave(player.getUniqueId());
    runtime.report(player, result, town -> Notices.success("You left " + town.name() + "."));
    if (result instanceof Result.Ok<Change<Town>, List<TownProblem>>(var change)) {
      afterSaved(
          change,
          () ->
              tellTown(change.value(), player, Notices.info(player.getName() + " left the town.")));
    }
  }

  void kick(Player player, PlayerRef target) {
    var result = members.kick(player.getUniqueId(), target);
    runtime.report(
        player, result, town -> Notices.success(target.name() + " is no longer a member."));
    if (result instanceof Result.Ok<Change<Town>, List<TownProblem>>(var change)) {
      afterSaved(
          change,
          () ->
              tell(
                  target.id(),
                  Notices.info("You were removed from your town by " + player.getName() + ".")));
    }
  }

  void promote(Player player, PlayerRef target) {
    var result = members.promote(player.getUniqueId(), target);
    runtime.report(
        player, result, town -> Notices.success(target.name() + " is now an assistant."));
    if (result instanceof Result.Ok<Change<Town>, List<TownProblem>>(var change)) {
      afterSaved(
          change, () -> tell(target.id(), Notices.info("You are now an assistant of your town.")));
    }
  }

  void demote(Player player, PlayerRef target) {
    var result = members.demote(player.getUniqueId(), target);
    runtime.report(player, result, town -> Notices.success(target.name() + " is now a member."));
  }

  void requestTransfer(Player player, PlayerRef target) {
    switch (members.requestTransfer(player.getUniqueId(), target)) {
      case Result.Ok<Town, List<TownProblem>>(var town) ->
          player.sendMessage(
              Notices.info(
                  "To hand "
                      + town.name()
                      + " to "
                      + target.name()
                      + ", type /town transfer confirm within "
                      + Explanations.wait(members.transferWindow())
                      + ". You will stay on as an assistant."));
      case Result.Err<Town, List<TownProblem>>(var problems) -> runtime.refuse(player, problems);
    }
  }

  private void confirmTransfer(Player player) {
    var result = members.confirmTransfer(player.getUniqueId());
    runtime.report(
        player,
        result,
        town -> Notices.success("You handed " + town.name() + " over. You are now an assistant."));
    if (result instanceof Result.Ok<Change<Town>, List<TownProblem>>(var change)) {
      var town = change.value();
      afterSaved(
          change,
          () ->
              tell(
                  town.owner(),
                  Notices.info(player.getName() + " handed " + town.name() + " to you.")));
    }
  }

  private void afterSaved(Change<Town> change, Runnable notification) {
    var _ =
        change
            .saved()
            .whenCompleteAsync(
                (saved, failure) -> {
                  if (failure == null) {
                    notification.run();
                  }
                },
                runtime.scheduler().mainThread());
  }

  private void rename(Player player, String name) {
    runtime.report(
        player,
        members.rename(player.getUniqueId(), name),
        town -> Notices.success("Your town is now called " + town.name() + "."));
  }

  private void infoOwn(Player player) {
    var town = towns.settling().state().townOf(player.getUniqueId());
    if (town.isEmpty()) {
      player.sendMessage(Notices.error(Explanations.explain(new TownProblem.NotInTown())));
      return;
    }
    info(player, town.get());
  }

  /** Tells {@code player} about {@code town}: its ranks, land and limit. */
  void info(Player player, Town town) {
    var claims = state().claimCount(town.id());
    var limit = towns.maxClaims(town);
    var level = towns.withLiveLevel(town).governorLevel();
    var _ =
        names
            .namesOf(town.members().keySet())
            .whenComplete(
                (known, failure) -> {
                  if (failure != null) {
                    player.sendMessage(Notices.error("Could not look up the town; try again."));
                    return;
                  }
                  player.sendMessage(Notices.info(town.name() + ": " + ranks(town, known)));
                  player.sendMessage(
                      Notices.info(
                          "Land: "
                              + claims
                              + " of "
                              + limit
                              + " chunks (owner's Governor level "
                              + level
                              + ")."));
                });
  }

  private static String ranks(Town town, Map<UUID, String> known) {
    return List.of(TownRole.OWNER, TownRole.ASSISTANT, TownRole.MEMBER).stream()
        .map(
            role -> {
              var holders =
                  town.members().entrySet().stream()
                      .filter(entry -> entry.getValue() == role)
                      .map(entry -> requireNonNull(known.get(entry.getKey())))
                      .sorted()
                      .toList();
              return holders.isEmpty()
                  ? ""
                  : role.name().toLowerCase(Locale.ROOT) + " " + String.join(", ", holders);
            })
        .filter(part -> !part.isEmpty())
        .collect(joining("; "));
  }

  /** Tells {@code player} about their open invitations, for when they join. */
  void tellInvitations(Player player) {
    for (var town : members.invitationsFor(player.getUniqueId())) {
      player.sendMessage(
          Notices.info(
              town.name()
                  + " has invited you. Type /town accept "
                  + town.name()
                  + " or /town deny "
                  + town.name()
                  + "."));
    }
  }

  private void tell(UUID player, Component message) {
    var online = server().getPlayer(player);
    if (online != null) {
      online.sendMessage(message);
    }
  }

  private void tellTown(Town town, Player except, Component message) {
    for (var member : town.members().keySet()) {
      if (!member.equals(except.getUniqueId())) {
        tell(member, message);
      }
    }
  }

  private CompletableFuture<Suggestions> suggestInvitations(
      CommandContext<CommandSourceStack> context, SuggestionsBuilder builder) {
    if (context.getSource().getSender() instanceof Player player) {
      members.invitationsFor(player.getUniqueId()).stream()
          .map(Town::name)
          .filter(name -> name.toLowerCase(Locale.ROOT).startsWith(builder.getRemainingLowerCase()))
          .forEach(builder::suggest);
    }
    return builder.buildFuture();
  }

  private TownsState state() {
    return towns.settling().state();
  }

  private Server server() {
    return names.server();
  }
}
