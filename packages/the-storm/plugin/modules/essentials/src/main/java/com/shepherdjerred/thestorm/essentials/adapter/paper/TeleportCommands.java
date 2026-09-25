package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.word;
import static io.papermc.paper.command.brigadier.Commands.argument;
import static io.papermc.paper.command.brigadier.Commands.literal;

import com.mojang.brigadier.suggestion.SuggestionProvider;
import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.essentials.app.WarpDirectory;
import com.shepherdjerred.thestorm.essentials.app.store.BackStore;
import com.shepherdjerred.thestorm.essentials.app.store.HomeStore;
import com.shepherdjerred.thestorm.essentials.domain.back.BackEntry;
import com.shepherdjerred.thestorm.essentials.domain.back.BackError;
import com.shepherdjerred.thestorm.essentials.domain.back.BackHistory;
import com.shepherdjerred.thestorm.essentials.domain.config.EssentialsConfig;
import com.shepherdjerred.thestorm.essentials.domain.home.Home;
import com.shepherdjerred.thestorm.essentials.domain.home.HomeError;
import com.shepherdjerred.thestorm.essentials.domain.home.HomeRules;
import com.shepherdjerred.thestorm.essentials.domain.place.PlaceName;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import com.shepherdjerred.thestorm.essentials.domain.place.Warp;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.List;
import java.util.Optional;
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;

/** {@code /spawn}, homes, {@code /back} and warps. */
final class TeleportCommands {

  private final PaperRuntime runtime;
  private final TeleportFlow flow;
  private final Places places;
  private final EssentialsConfig config;

  /**
   * Where players can go.
   *
   * @param homes players' homes
   * @param warps server warps
   * @param back {@code /back} history
   * @param protection land protection, asked before a home is set
   */
  record Places(HomeStore homes, WarpDirectory warps, BackStore back, Protection protection) {}

  TeleportCommands(
      PaperRuntime runtime, TeleportFlow flow, Places places, EssentialsConfig config) {
    this.runtime = runtime;
    this.flow = flow;
    this.places = places;
    this.config = config;
  }

  void register(Commands commands) {
    commands.register(
        literal("spawn")
            .requires(Cmd.permission(EssentialsPermissions.SPAWN))
            .executes(context -> Cmd.asPlayer(context, this::spawn))
            .build(),
        "Teleport to spawn");
    registerHomes(commands);
    commands.register(
        literal("back")
            .requires(Cmd.permission(EssentialsPermissions.BACK))
            .executes(context -> Cmd.asPlayer(context, this::back))
            .build(),
        "Return to where you last teleported from or died");
    registerWarps(commands);
  }

  private void registerHomes(Commands commands) {
    commands.register(
        literal("home")
            .requires(Cmd.permission(EssentialsPermissions.HOME))
            .executes(context -> Cmd.asPlayer(context, player -> home(player, Optional.empty())))
            .then(
                argument("name", word())
                    .suggests(homeNames())
                    .executes(
                        context ->
                            Cmd.asPlayer(
                                context,
                                player ->
                                    withName(
                                        player,
                                        Cmd.string(context, "name"),
                                        name -> home(player, Optional.of(name))))))
            .build(),
        "Teleport to one of your homes");
    commands.register(
        literal("sethome")
            .requires(Cmd.permission(EssentialsPermissions.HOME))
            .executes(
                context -> Cmd.asPlayer(context, player -> setHome(player, HomeRules.DEFAULT_NAME)))
            .then(
                argument("name", word())
                    .executes(
                        context ->
                            Cmd.asPlayer(
                                context,
                                player ->
                                    withName(
                                        player,
                                        Cmd.string(context, "name"),
                                        name -> setHome(player, name)))))
            .build(),
        "Set a home where you stand");
    commands.register(
        literal("delhome")
            .requires(Cmd.permission(EssentialsPermissions.HOME))
            .then(
                argument("name", word())
                    .suggests(homeNames())
                    .executes(
                        context ->
                            Cmd.asPlayer(
                                context,
                                player ->
                                    withName(
                                        player,
                                        Cmd.string(context, "name"),
                                        name -> deleteHome(player, name)))))
            .build(),
        "Delete one of your homes");
    commands.register(
        literal("homes")
            .requires(Cmd.permission(EssentialsPermissions.HOME))
            .executes(context -> Cmd.asPlayer(context, this::listHomes))
            .build(),
        "List your homes");
  }

  private void registerWarps(Commands commands) {
    commands.register(
        literal("warp")
            .requires(Cmd.permission(EssentialsPermissions.WARP))
            .executes(context -> Cmd.asPlayer(context, this::listWarps))
            .then(
                argument("name", word())
                    .suggests(Cmd.suggest(this::warpNames))
                    .executes(
                        context ->
                            Cmd.asPlayer(
                                context,
                                player ->
                                    withName(
                                        player,
                                        Cmd.string(context, "name"),
                                        n -> warp(player, n)))))
            .build(),
        "Teleport to a warp");
    commands.register(
        literal("setwarp")
            .requires(Cmd.permission(EssentialsPermissions.SET_WARP))
            .then(
                argument("name", word())
                    .executes(
                        context ->
                            Cmd.asPlayer(
                                context,
                                player ->
                                    withName(
                                        player,
                                        Cmd.string(context, "name"),
                                        n -> setWarp(player, n)))))
            .build(),
        "Set a warp where you stand");
    commands.register(
        literal("delwarp")
            .requires(Cmd.permission(EssentialsPermissions.SET_WARP))
            .then(
                argument("name", word())
                    .suggests(Cmd.suggest(this::warpNames))
                    .executes(
                        context ->
                            Cmd.asPlayer(
                                context,
                                player ->
                                    withName(
                                        player,
                                        Cmd.string(context, "name"),
                                        n -> deleteWarp(player, n)))))
            .build(),
        "Delete a warp");
  }

  private void spawn(Player player) {
    go(player, TeleportKind.SPAWN, config.spawn(), "spawn");
  }

  private void home(Player player, Optional<PlaceName> requested) {
    runtime.onMain(
        places.homes().homes(player.getUniqueId()),
        "loading homes",
        homes -> {
          if (!player.isOnline()) {
            return;
          }
          switch (HomeRules.resolve(homes, requested)) {
            case Result.Ok<Home, HomeError>(var home) ->
                go(player, TeleportKind.HOME, home.position(), "home " + home.name());
            case Result.Err<Home, HomeError>(var error) ->
                Say.error(player, Say.HOMES, describe(error));
          }
        });
  }

  private void setHome(Player player, PlaceName name) {
    var decision =
        places
            .protection()
            .check(player.getUniqueId(), ProtectedAction.SET_HOME, Positions.current(player));
    if (decision instanceof Decision.Denied(var reason)) {
      player.sendMessage(
          HouseStyle.error(
              Say.HOMES, Component.text("You can't set a home here: ").append(reason)));
      return;
    }
    var home = new Home(name, Positions.of(player));
    runtime.onMain(
        places.homes().set(player.getUniqueId(), home, config.homeLimit()),
        "setting a home",
        result -> {
          switch (result) {
            case Result.Ok<HomeRules.Change, HomeError>(var change) ->
                Say.success(
                    player,
                    Say.HOMES,
                    (change == HomeRules.Change.CREATED ? "Home " : "Moved home ") + name + ".");
            case Result.Err<HomeRules.Change, HomeError>(var error) ->
                Say.error(player, Say.HOMES, describe(error));
          }
        });
  }

  private void deleteHome(Player player, PlaceName name) {
    runtime.onMain(
        places.homes().delete(player.getUniqueId(), name),
        "deleting a home",
        deleted -> {
          if (deleted) {
            Say.success(player, Say.HOMES, "Deleted home " + name + ".");
          } else {
            Say.error(player, Say.HOMES, "You have no home called " + name + ".");
          }
        });
  }

  private void listHomes(Player player) {
    runtime.onMain(
        places.homes().homes(player.getUniqueId()),
        "listing homes",
        homes -> {
          if (homes.isEmpty()) {
            Say.info(player, Say.HOMES, "You have no homes. Set one with /sethome.");
            return;
          }
          var names = homes.stream().map(home -> home.name().value()).toList();
          Say.info(
              player,
              Say.HOMES,
              "Homes ("
                  + homes.size()
                  + "/"
                  + config.homeLimit()
                  + "): "
                  + String.join(", ", names));
        });
  }

  private void back(Player player) {
    var capacity = config.teleports().backHistorySize();
    runtime.onMain(
        places.back().history(player.getUniqueId(), capacity),
        "loading /back history",
        history -> goBack(player, history));
  }

  private void goBack(Player player, BackHistory history) {
    if (!player.isOnline()) {
      return;
    }
    switch (history.select(1)) {
      case Result.Ok<BackEntry, BackError>(var entry) ->
          go(
              player,
              TeleportKind.BACK,
              entry.position(),
              entry.cause() == BackEntry.Cause.DEATH ? "where you died" : "your last location");
      case Result.Err<BackEntry, BackError> _ ->
          Say.error(player, Say.TELEPORT, "You have nowhere to go back to.");
    }
  }

  private void warp(Player player, PlaceName name) {
    places
        .warps()
        .find(name)
        .ifPresentOrElse(
            found -> go(player, TeleportKind.WARP, found.position(), "warp " + name),
            () -> Say.error(player, Say.WARPS, "There is no warp called " + name + "."));
  }

  private void listWarps(Player player) {
    var names = warpNames();
    if (names.isEmpty()) {
      Say.info(player, Say.WARPS, "There are no warps yet.");
    } else {
      Say.info(player, Say.WARPS, "Warps: " + String.join(", ", names));
    }
  }

  private void setWarp(Player player, PlaceName name) {
    runtime.onMain(
        places.warps().set(new Warp(name, Positions.of(player))),
        "setting a warp",
        done -> Say.success(player, Say.WARPS, "Warp " + name + " set."));
  }

  private void deleteWarp(Player player, PlaceName name) {
    runtime.onMain(
        places.warps().delete(name),
        "deleting a warp",
        deleted -> {
          if (deleted) {
            Say.success(player, Say.WARPS, "Deleted warp " + name + ".");
          } else {
            Say.error(player, Say.WARPS, "There is no warp called " + name + ".");
          }
        });
  }

  private void go(Player player, TeleportKind kind, Position position, String description) {
    Positions.toLocation(runtime.server(), position)
        .ifPresentOrElse(
            location ->
                flow.start(Ticket.self(player, kind, Destination.fixed(location, description))),
            () ->
                Say.error(
                    player, Say.TELEPORT, "The world " + position.world() + " is not loaded."));
  }

  private List<String> warpNames() {
    return places.warps().names().stream().map(PlaceName::value).toList();
  }

  private SuggestionProvider<CommandSourceStack> homeNames() {
    return (context, builder) -> {
      if (!(context.getSource().getSender() instanceof Player player)) {
        return builder.buildFuture();
      }
      return places
          .homes()
          .homes(player.getUniqueId())
          .thenApply(
              homes -> {
                Cmd.addMatching(builder, homes.stream().map(h -> h.name().value()).toList());
                return builder.build();
              });
    };
  }

  private static void withName(Player player, String input, Consumer<PlaceName> action) {
    switch (PlaceName.parse(input)) {
      case Result.Ok<PlaceName, String>(var name) -> action.accept(name);
      case Result.Err<PlaceName, String>(var error) -> Say.error(player, Say.TELEPORT, error);
    }
  }

  private static String describe(HomeError error) {
    return switch (error) {
      case HomeError.LimitReached(var limit) ->
          "You already have " + limit + " homes, the most allowed. Move one or /delhome one.";
      case HomeError.NoHomes() -> "You have no homes. Set one with /sethome.";
      case HomeError.NotFound(var name, var available) ->
          "You have no home called " + name + ". Your homes: " + join(available);
      case HomeError.Ambiguous(var available) -> "Which home? " + join(available);
    };
  }

  private static String join(List<PlaceName> names) {
    return String.join(", ", names.stream().map(PlaceName::value).toList());
  }
}
