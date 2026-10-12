package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.suggestion.SuggestionProvider;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.rwf.adapter.content.RwfConfig;
import com.shepherdjerred.thestorm.rwf.app.JoinGate;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.Collection;
import java.util.Locale;
import java.util.Optional;
import java.util.function.Consumer;
import java.util.function.Predicate;
import java.util.function.Supplier;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/** {@code /rwf}: join, leave, watch, pick a kit, see who is in, and the admin tools. */
final class RwfCommands {

  private static final int OK = Command.SINGLE_SUCCESS;

  private final PaperContext context;
  private final MatchRunner runner;
  private final Watchers watchers;
  private final KitFactory kits;
  private final JoinGate gate;
  private final RwfConfig config;
  private final Bots bots;

  /**
   * What the commands need.
   *
   * @param context the shared server services
   * @param runner the match
   * @param watchers players watching the match
   * @param kits the kits, for suggestions
   * @param gate the managed rollout decision for joining
   * @param config the module settings
   * @param bots the bot roster, for the load test and status
   */
  record Parts(
      PaperContext context,
      MatchRunner runner,
      Watchers watchers,
      KitFactory kits,
      JoinGate gate,
      RwfConfig config,
      Bots bots) {}

  RwfCommands(Parts parts) {
    this.context = parts.context();
    this.runner = parts.runner();
    this.watchers = parts.watchers();
    this.kits = parts.kits();
    this.gate = parts.gate();
    this.config = parts.config();
    this.bots = parts.bots();
  }

  void register(Commands commands) {
    commands.register(tree(), "Red Warfare Search and Destroy: /rwf join");
  }

  LiteralCommandNode<CommandSourceStack> tree() {
    return Commands.literal("rwf")
        .executes(ctx -> usage(ctx.getSource().getSender()))
        .then(
            Commands.literal("join")
                .requires(permission(RwfPermissions.PLAY))
                .executes(ctx -> asPlayer(ctx, this::join)))
        .then(
            Commands.literal("leave")
                .requires(permission(RwfPermissions.PLAY).or(permission(RwfPermissions.SPECTATE)))
                .executes(ctx -> asPlayer(ctx, this::leave)))
        .then(
            Commands.literal("spectate")
                .requires(permission(RwfPermissions.SPECTATE))
                .executes(ctx -> asPlayer(ctx, this::spectate))
                .then(
                    Commands.literal("next")
                        .executes(
                            ctx ->
                                asPlayer(
                                    ctx,
                                    player ->
                                        watchers
                                            .next(player)
                                            .ifPresent(message -> Texts.error(player, message))))))
        .then(
            Commands.literal("kit")
                .requires(permission(RwfPermissions.PLAY))
                .then(
                    Commands.argument("kit", StringArgumentType.word())
                        .suggests(suggest(kits::kitIds))
                        .executes(
                            ctx ->
                                asPlayer(
                                    ctx,
                                    player ->
                                        pickKit(
                                            player, StringArgumentType.getString(ctx, "kit"))))))
        .then(
            Commands.literal("who")
                .requires(permission(RwfPermissions.PLAY))
                .executes(ctx -> who(ctx.getSource().getSender())))
        .then(
            Commands.literal("admin")
                .requires(permission(RwfPermissions.ADMIN))
                .then(
                    Commands.literal("status").executes(ctx -> status(ctx.getSource().getSender())))
                .then(
                    Commands.literal("repair").executes(ctx -> repair(ctx.getSource().getSender())))
                .then(
                    Commands.literal("loadtest")
                        .then(
                            Commands.argument("bots", IntegerArgumentType.integer(1, 100))
                                .executes(
                                    ctx ->
                                        loadTest(
                                            ctx.getSource().getSender(),
                                            IntegerArgumentType.getInteger(ctx, "bots")))))
                .then(
                    Commands.literal("showcase")
                        .executes(
                            ctx ->
                                showcase(
                                    ctx.getSource().getSender(), config.match().targetCombatants()))
                        .then(
                            Commands.argument(
                                    "count",
                                    IntegerArgumentType.integer(2, config.match().maxCombatants()))
                                .executes(
                                    ctx ->
                                        showcase(
                                            ctx.getSource().getSender(),
                                            IntegerArgumentType.getInteger(ctx, "count"))))))
        .build();
  }

  private static int usage(CommandSender sender) {
    Texts.info(
        sender,
        "/rwf join, /rwf leave, /rwf kit <kit>, /rwf who, /rwf spectate, /rwf spectate next");
    return OK;
  }

  /** The managed flag decides, off the main thread; the match decides after. */
  private void join(Player player) {
    context.onMain(
        gate.allows(player.getUniqueId()),
        allowed -> {
          if (!allowed) {
            Texts.error(player, "Search and Destroy is not open to you yet.");
            return;
          }
          if (!player.isOnline()) {
            return;
          }
          var refusal =
              watchers.watching(player.getUniqueId())
                  ? watchers.join(player)
                  : runner.admit(player);
          refusal.ifPresent(message -> Texts.error(player, message));
        },
        "evaluate the rwf join flag for " + player.getName());
  }

  /** Watching is behind the same managed flag as joining: it shows the game. */
  private void spectate(Player player) {
    context.onMain(
        gate.allows(player.getUniqueId()),
        allowed -> {
          if (!allowed) {
            Texts.error(player, "Search and Destroy is not open to you yet.");
            return;
          }
          if (!player.isOnline()) {
            return;
          }
          watchers.watch(player).ifPresent(message -> Texts.error(player, message));
        },
        "evaluate the rwf join flag for watcher " + player.getName());
  }

  private void leave(Player player) {
    if (watchers.leave(player)) {
      return;
    }
    runner.leave(player).ifPresent(error -> Texts.error(player, error));
  }

  private void pickKit(Player player, String kit) {
    runner.pickKit(player, kit).ifPresent(error -> Texts.error(player, error));
  }

  private int who(CommandSender sender) {
    var snapshot = runner.current();
    if (snapshot.isEmpty()) {
      Texts.info(sender, "The match is still being prepared.");
      return OK;
    }
    var view = snapshot.orElseThrow();
    Texts.info(
        sender,
        "Phase: "
            + view.phase().name().toLowerCase(Locale.ROOT)
            + view.mapId().map(map -> " on " + map).orElse("")
            + ", "
            + view.combatants().size()
            + " combatants");
    // Teams are dealt when the match goes live; before that everyone is in the lobby.
    var waiting =
        view.phase() == MatchSnapshot.PhaseKind.LOBBY
            || view.phase() == MatchSnapshot.PhaseKind.COUNTDOWN;
    if (waiting || view.teams().isEmpty()) {
      Texts.info(sender, "In the lobby: " + names(view, Optional.empty()));
      return OK;
    }
    for (var team : view.teams()) {
      Texts.info(sender, team.displayName() + ": " + names(view, Optional.of(team)));
    }
    return OK;
  }

  private static String names(MatchSnapshot view, Optional<TeamColor> team) {
    var joined =
        view.combatants().stream()
            .filter(c -> team.isEmpty() || c.team().equals(team))
            .map(
                c ->
                    c.name()
                        + (c.id().isBot() ? Scoreboards.BOT_SUFFIX : "")
                        + c.kit().map(kit -> " [" + kit + "]").orElse("")
                        + (c.alive() ? "" : " (out)"))
            .toList();
    return joined.isEmpty() ? "nobody" : String.join(", ", joined);
  }

  private int status(CommandSender sender) {
    var match = runner.match();
    Texts.info(sender, "Ready: " + runner.ready() + ", phase: " + match.phase());
    Texts.info(
        sender,
        "Match "
            + match.matchId()
            + ", map "
            + match.map().map(m -> m.id()).orElse("none")
            + ", "
            + runner.humans()
            + " humans, "
            + (match.members().size() - runner.humans())
            + " bots, bot roster "
            + (bots.roster().isPresent() ? "present" : "absent"));
    Texts.info(
        sender,
        "Watchers: "
            + watchers.count()
            + ", showcase: "
            + (runner.showcase() ? "yes" : "no")
            + ", bots arriving: "
            + runner.arriving());
    if (runner.ready()) {
      var map = runner.currentMap();
      Texts.info(sender, "Map busy: " + map.busy() + ", cratered blocks: " + map.crateredBlocks());
    }
    var lobby = runner.lobbyRoom();
    Texts.info(sender, "Lobby ready: " + lobby.ready() + ", busy: " + lobby.busy());
    return OK;
  }

  private int repair(CommandSender sender) {
    if (!runner.ready() || runner.live()) {
      Texts.error(sender, "Repair only between matches, once the maps are ready.");
      return OK;
    }
    var map = runner.currentMap();
    var lobby = runner.lobbyRoom();
    if (map.busy() || lobby.busy()) {
      Texts.error(sender, "The map or the lobby is already being verified or pasted.");
      return OK;
    }
    Texts.info(sender, "Verifying " + map.map().id() + " and the lobby...");
    map.verifyAndRepair(
        ok -> {
          Texts.info(
              sender,
              ok ? "Map " + map.map().id() + " is intact." : "Map repair failed; see the log.");
          lobby.verifyAndRepair(
              intact ->
                  Texts.info(
                      sender,
                      intact ? "The lobby is intact." : "Lobby repair failed; see the log."));
        });
    return OK;
  }

  private int loadTest(CommandSender sender, int count) {
    if (!config.loadtest().enabled()) {
      Texts.error(sender, "The load test is disabled in rwf.yml.");
      return OK;
    }
    if (bots.roster().isEmpty()) {
      Texts.error(sender, "No bot roster is provided; enable the rwfbots module.");
      return OK;
    }
    var joined = runner.loadTest(count);
    Texts.info(sender, "Added " + joined + " bots to the lobby.");
    return OK;
  }

  private int showcase(CommandSender sender, int count) {
    var refusal = runner.startShowcase(count);
    if (refusal.isPresent()) {
      Texts.error(sender, refusal.orElseThrow());
    } else {
      Texts.info(
          sender,
          "Showcase of "
              + count
              + " bots started; it counts down and plays like any match. Watch with /rwf"
              + " spectate.");
    }
    return OK;
  }

  private static Predicate<CommandSourceStack> permission(String permission) {
    return source -> source.getSender().hasPermission(permission);
  }

  private static int asPlayer(CommandContext<CommandSourceStack> ctx, Consumer<Player> action) {
    if (ctx.getSource().getSender() instanceof Player player) {
      action.accept(player);
      return OK;
    }
    Texts.error(ctx.getSource().getSender(), "Only players can do that.");
    return 0;
  }

  private static SuggestionProvider<CommandSourceStack> suggest(
      Supplier<Collection<String>> options) {
    return (ctx, builder) -> {
      var typed = builder.getRemaining().toLowerCase(Locale.ROOT);
      options.get().stream().filter(option -> option.startsWith(typed)).forEach(builder::suggest);
      return builder.buildFuture();
    };
  }
}
