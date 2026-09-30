package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.RequiredArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.suggestion.SuggestionProvider;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.arena.app.store.LeaderboardStore;
import com.shepherdjerred.thestorm.arena.domain.game.GameEvent;
import com.shepherdjerred.thestorm.arena.domain.kit.ClassBook;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.Collection;
import java.util.Locale;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import java.util.function.Predicate;
import java.util.function.Supplier;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/** {@code /arena}: join, leave, spectate, pick a class, ready, the leaderboard and admin tools. */
final class ArenaCommands {

  private static final int OK = Command.SINGLE_SUCCESS;
  private static final int TOP_ROWS = 10;
  private static final int TARGET_REACH = 6;

  private final PaperContext context;
  private final Arenas arenas;
  private final ClassBook classes;
  private final LeaderboardStore leaderboard;

  ArenaCommands(
      PaperContext context, Arenas arenas, ClassBook classes, LeaderboardStore leaderboard) {
    this.context = context;
    this.arenas = arenas;
    this.classes = classes;
    this.leaderboard = leaderboard;
  }

  void register(Commands commands) {
    commands.register(tree(), "Mob Arena: /arena join <arena>");
  }

  LiteralCommandNode<CommandSourceStack> tree() {
    return Commands.literal("arena")
        .executes(context -> usage(context.getSource().getSender()))
        .then(
            Commands.literal("join")
                .requires(permission(ArenaPermissions.PLAY))
                .then(arenaArgument(this::join)))
        .then(
            Commands.literal("spec")
                .requires(permission(ArenaPermissions.SPECTATE))
                .then(arenaArgument(this::spectate)))
        .then(
            Commands.literal("leave")
                .requires(permission(ArenaPermissions.PLAY))
                .executes(context -> asPlayer(context, this::leave)))
        .then(
            Commands.literal("class")
                .requires(permission(ArenaPermissions.PLAY))
                .then(
                    Commands.argument("class", StringArgumentType.word())
                        .suggests(suggest(() -> classes.classes().keySet()))
                        .executes(
                            context ->
                                asPlayer(
                                    context,
                                    player ->
                                        pickClass(
                                            player,
                                            StringArgumentType.getString(context, "class"))))))
        .then(
            Commands.literal("ready")
                .requires(permission(ArenaPermissions.PLAY))
                .executes(context -> asPlayer(context, this::ready)))
        .then(
            Commands.literal("list")
                .requires(permission(ArenaPermissions.PLAY))
                .executes(context -> list(context.getSource().getSender())))
        .then(
            Commands.literal("top")
                .requires(permission(ArenaPermissions.TOP))
                .then(
                    Commands.argument("arena", StringArgumentType.word())
                        .suggests(suggest(arenas::ids))
                        .executes(
                            context ->
                                top(
                                    context.getSource().getSender(),
                                    StringArgumentType.getString(context, "arena")))))
        .then(
            Commands.literal("here")
                .requires(permission(ArenaPermissions.ADMIN))
                .executes(context -> asPlayer(context, ArenaCommands::here)))
        .then(
            Commands.literal("start")
                .requires(permission(ArenaPermissions.ADMIN))
                .then(adminArenaArgument(this::start)))
        .then(
            Commands.literal("stop")
                .requires(permission(ArenaPermissions.ADMIN))
                .then(adminArenaArgument(this::stop)))
        .build();
  }

  private RequiredArgumentBuilder<CommandSourceStack, String> arenaArgument(
      BiConsumer<Player, GameRunner> action) {
    return Commands.argument("arena", StringArgumentType.word())
        .suggests(suggest(arenas::ids))
        .executes(
            context ->
                asPlayer(
                    context,
                    player -> {
                      var id = StringArgumentType.getString(context, "arena");
                      arenas
                          .byId(id)
                          .ifPresentOrElse(
                              runner -> action.accept(player, runner),
                              () -> Texts.error(player, "There is no arena called " + id + "."));
                    }));
  }

  private RequiredArgumentBuilder<CommandSourceStack, String> adminArenaArgument(
      BiConsumer<CommandSender, GameRunner> action) {
    return Commands.argument("arena", StringArgumentType.word())
        .suggests(suggest(arenas::ids))
        .executes(
            context -> {
              var sender = context.getSource().getSender();
              var id = StringArgumentType.getString(context, "arena");
              arenas
                  .byId(id)
                  .ifPresentOrElse(
                      runner -> action.accept(sender, runner),
                      () -> Texts.error(sender, "There is no arena called " + id + "."));
              return OK;
            });
  }

  private void join(Player player, GameRunner runner) {
    arenas.join(player, runner);
  }

  private void spectate(Player player, GameRunner runner) {
    arenas.spectate(player, runner);
  }

  private void leave(Player player) {
    arenas
        .of(player.getUniqueId())
        .ifPresentOrElse(
            runner ->
                runner
                    .handle(new GameEvent.Leave(player.getUniqueId()))
                    .ifPresent(error -> Texts.error(player, error)),
            () -> Texts.error(player, "You are not in an arena."));
  }

  /** Picks a class, checking the class's permission if it is advanced. */
  void pickClass(Player player, String kit) {
    var runner = arenas.of(player.getUniqueId());
    if (runner.isEmpty()) {
      Texts.error(player, "You are not in an arena.");
      return;
    }
    var permitted =
        classes
            .find(kit)
            .map(c -> !c.advanced() || player.hasPermission(ClassBook.permission(kit)))
            .orElse(true);
    runner
        .orElseThrow()
        .handle(new GameEvent.PickClass(player.getUniqueId(), kit, permitted))
        .ifPresent(error -> Texts.error(player, error));
  }

  void ready(Player player) {
    arenas
        .of(player.getUniqueId())
        .ifPresentOrElse(
            runner ->
                runner
                    .handle(new GameEvent.Ready(player.getUniqueId()))
                    .ifPresent(error -> Texts.error(player, error)),
            () -> Texts.error(player, "You are not in an arena."));
  }

  private static int usage(CommandSender sender) {
    Texts.info(
        sender,
        "/arena join <arena>, /arena class <class>, /arena ready, /arena leave,"
            + " /arena spec <arena>, /arena list, /arena top <arena>");
    return OK;
  }

  private int list(CommandSender sender) {
    for (var runner : arenas.all()) {
      var definition = runner.world().definition();
      var game = runner.game();
      var state = game.phase().running() ? "fighting" : game.isEmpty() ? "open" : "gathering";
      Texts.info(
          sender,
          definition.id()
              + " ("
              + definition.name()
              + "): "
              + state
              + ", "
              + game.members().size()
              + " inside");
    }
    return OK;
  }

  private int top(CommandSender sender, String arena) {
    if (arenas.byId(arena).isEmpty()) {
      Texts.error(sender, "There is no arena called " + arena + ".");
      return OK;
    }
    context.onMain(
        leaderboard.top(arena, TOP_ROWS),
        standings -> {
          if (standings.isEmpty()) {
            Texts.info(sender, "Nobody has fought in " + arena + " yet.");
            return;
          }
          Texts.info(sender, "Furthest waves in " + arena + ":");
          for (var i = 0; i < standings.size(); i++) {
            var standing = standings.get(i);
            sender.sendMessage(
                Component.text((i + 1) + ". ", NamedTextColor.DARK_GRAY)
                    .append(Component.text(standing.name(), NamedTextColor.WHITE))
                    .append(Component.text(" - wave " + standing.wave(), NamedTextColor.GRAY)));
          }
        },
        "read the arena leaderboard");
    return OK;
  }

  /** Prints the player's position, and the block they look at, as YAML for arena files. */
  private static void here(Player player) {
    var location = Places.at(player);
    var spot = Places.spot(location);
    Texts.info(player, "World: " + location.getWorld().getName());
    Texts.info(player, copyable("Spot (lobby, spawns, exit): ", spot.describe()));
    Texts.info(
        player,
        copyable(
            "Point (mob spawn): ",
            "{x: " + spot.x() + ", y: " + spot.y() + ", z: " + spot.z() + "}"));
    Texts.info(
        player, copyable("Block you stand in: ", Places.pos(location.getBlock()).describe()));
    var target = player.getTargetBlockExact(TARGET_REACH);
    if (target != null) {
      Texts.info(
          player,
          copyable(
              "Block you look at (" + target.getType().name().toLowerCase(Locale.ROOT) + "): ",
              Places.pos(target).describe()));
    }
  }

  private static Component copyable(String label, String yaml) {
    return Component.text(label)
        .append(
            Component.text(yaml, NamedTextColor.WHITE)
                .clickEvent(ClickEvent.copyToClipboard(yaml)));
  }

  private void start(CommandSender sender, GameRunner runner) {
    runner
        .handle(new GameEvent.ForceStart(context.time().instant()))
        .ifPresentOrElse(
            error -> Texts.error(sender, error),
            () -> Texts.info(sender, "Started " + runner.id() + "."));
  }

  private void stop(CommandSender sender, GameRunner runner) {
    runner.handle(new GameEvent.Stop());
    Texts.info(sender, "Stopped " + runner.id() + "; everyone inside was restored.");
  }

  private static Predicate<CommandSourceStack> permission(String permission) {
    return source -> source.getSender().hasPermission(permission);
  }

  private static int asPlayer(CommandContext<CommandSourceStack> context, Consumer<Player> action) {
    if (context.getSource().getSender() instanceof Player player) {
      action.accept(player);
      return OK;
    }
    Texts.error(context.getSource().getSender(), "Only players can do that.");
    return 0;
  }

  private static SuggestionProvider<CommandSourceStack> suggest(
      Supplier<Collection<String>> options) {
    return (context, builder) -> {
      var typed = builder.getRemaining().toLowerCase(Locale.ROOT);
      options.get().stream().filter(option -> option.startsWith(typed)).forEach(builder::suggest);
      return builder.buildFuture();
    };
  }
}
