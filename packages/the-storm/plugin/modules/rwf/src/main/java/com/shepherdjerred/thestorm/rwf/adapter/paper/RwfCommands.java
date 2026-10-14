package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.suggestion.SuggestionProvider;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.rwf.adapter.content.RwfConfig;
import com.shepherdjerred.thestorm.rwf.app.JoinGate;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.Killstreak;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.StreakLoadout;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbySizing;
import com.shepherdjerred.thestorm.rwf.domain.match.Ballot;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchError;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.domain.match.Phase;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.time.Duration;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.function.Consumer;
import java.util.function.Predicate;
import java.util.function.Supplier;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/**
 * {@code /rwf}: join, leave, watch, pick, browse and buy kits, this week's free kits, credits, vote
 * for the map, see who is in and how long is left, the spectator tools, and the operator's tools to
 * run matches; plus {@code /suicide} inside a match.
 */
final class RwfCommands {

  private static final int OK = Command.SINGLE_SUCCESS;

  private final PaperContext context;
  private final MatchRunner runner;
  private final Watchers watchers;
  private final com.shepherdjerred.thestorm.rwf.app.store.QuarantineStore quarantines;
  private final KitFactory kits;
  private final KitMenus menus;
  private final JoinGate gate;
  private final RwfConfig config;
  private final Bots bots;
  private final Stats stats;
  private final Spectating spectating;
  private final TeamChat teamChat;
  private final ExperienceCommands experience;

  /**
   * What the commands need.
   *
   * @param context the shared server services
   * @param runner the match
   * @param watchers players watching the match
   * @param kits the kits, for suggestions
   * @param menus the kit menu and shop
   * @param gate the managed rollout decision for joining
   * @param config the module settings
   * @param bots the bot roster, for the load test and status
   * @param stats statistics and match history
   * @param spectating the dead's and watchers' tools
   * @param teamChat the auto team chat toggle
   */
  record Parts(
      PaperContext context,
      MatchRunner runner,
      Watchers watchers,
      KitFactory kits,
      KitMenus menus,
      JoinGate gate,
      RwfConfig config,
      Bots bots,
      Stats stats,
      Spectating spectating,
      TeamChat teamChat,
      com.shepherdjerred.thestorm.rwf.app.store.QuarantineStore quarantines) {}

  RwfCommands(Parts parts) {
    this.context = parts.context();
    this.runner = parts.runner();
    this.watchers = parts.watchers();
    this.quarantines = parts.quarantines();
    this.kits = parts.kits();
    this.menus = parts.menus();
    this.gate = parts.gate();
    this.config = parts.config();
    this.bots = parts.bots();
    this.stats = parts.stats();
    this.spectating = parts.spectating();
    this.teamChat = parts.teamChat();
    this.experience = new ExperienceCommands(runner, kits);
  }

  void register(Commands commands) {
    commands.register(tree(), "Red Warfare Search and Destroy: /rwf join");
    commands.register(suicide(), "Give up your life in a Search and Destroy match");
  }

  LiteralCommandNode<CommandSourceStack> suicide() {
    return Commands.literal("suicide")
        .requires(permission(RwfPermissions.SUICIDE))
        .executes(ctx -> asPlayer(ctx, this::killSelf))
        .build();
  }

  private LiteralArgumentBuilder<CommandSourceStack> killstreaks() {
    return Commands.literal("killstreaks")
        .requires(permission(RwfPermissions.PLAY))
        .executes(ctx -> asPlayer(ctx, player -> runner.streakPicker().open(player)))
        .then(
            Commands.argument("first", StringArgumentType.word())
                .suggests(suggest(RwfCommands::rewardIds))
                .then(
                    Commands.argument("second", StringArgumentType.word())
                        .suggests(suggest(RwfCommands::rewardIds))
                        .then(
                            Commands.argument("third", StringArgumentType.word())
                                .suggests(suggest(RwfCommands::rewardIds))
                                .executes(
                                    ctx ->
                                        asPlayer(
                                            ctx,
                                            player ->
                                                selectRewards(
                                                    player,
                                                    List.of(
                                                        StringArgumentType.getString(ctx, "first"),
                                                        StringArgumentType.getString(ctx, "second"),
                                                        StringArgumentType.getString(
                                                            ctx, "third"))))))));
  }

  private static Collection<String> rewardIds() {
    return Arrays.stream(Killstreak.values())
        .map(reward -> reward.name().toLowerCase(Locale.ROOT).replace('_', '-'))
        .toList();
  }

  private void selectRewards(Player player, List<String> ids) {
    try {
      var choices =
          ids.stream()
              .map(id -> Killstreak.valueOf(id.toUpperCase(Locale.ROOT).replace('-', '_')))
              .toList();
      runner.streakPicker().select(player, new StreakLoadout(choices));
    } catch (IllegalArgumentException _) {
      Texts.error(
          player,
          "Choose three known rewards with distinct kill thresholds: "
              + String.join(", ", rewardIds())
              + ".");
    }
  }

  LiteralCommandNode<CommandSourceStack> tree() {
    var root = Commands.literal("rwf");
    stats.addTo(root);
    return root.executes(ctx -> usage(ctx.getSource().getSender()))
        .then(
            Commands.literal("join")
                .requires(permission(RwfPermissions.PLAY))
                .executes(ctx -> asPlayer(ctx, this::join)))
        .then(
            Commands.literal("leave")
                .requires(permission(RwfPermissions.PLAY).or(permission(RwfPermissions.SPECTATE)))
                .executes(ctx -> asPlayer(ctx, this::leave)))
        .then(
            Commands.literal("recording")
                .requires(permission(RwfPermissions.PLAY))
                .executes(ctx -> asPlayer(ctx, this::recordingStatus)))
        .then(spectate())
        .then(killstreaks())
        .then(
            Commands.literal("goto")
                .requires(permission(RwfPermissions.SPECTATE))
                .then(
                    Commands.argument("player", StringArgumentType.word())
                        .suggests(suggest(this::followableNames))
                        .executes(
                            ctx ->
                                asPlayer(
                                    ctx,
                                    player ->
                                        spectating
                                            .goTo(
                                                player, StringArgumentType.getString(ctx, "player"))
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
            Commands.literal("kits")
                .requires(permission(RwfPermissions.PLAY))
                .executes(
                    ctx ->
                        asPlayer(
                            ctx,
                            player ->
                                runner
                                    .picker()
                                    .open(player)
                                    .ifPresent(message -> Texts.error(player, message)))))
        .then(
            Commands.literal("buy")
                .requires(permission(RwfPermissions.PLAY))
                .then(
                    Commands.argument("kit", StringArgumentType.word())
                        .suggests(suggest(kits::kitIds))
                        .executes(
                            ctx ->
                                asPlayer(
                                    ctx,
                                    player ->
                                        buy(player, StringArgumentType.getString(ctx, "kit"))))))
        .then(
            Commands.literal("rotation")
                .requires(permission(RwfPermissions.PLAY))
                .executes(ctx -> rotation(ctx.getSource().getSender())))
        .then(
            Commands.literal("credits")
                .requires(permission(RwfPermissions.PLAY))
                .executes(ctx -> asPlayer(ctx, this::credits)))
        .then(
            Commands.literal("maps")
                .requires(permission(RwfPermissions.VOTE))
                .executes(ctx -> asPlayer(ctx, runner::openCandidates)))
        .then(
            Commands.literal("visit")
                .requires(permission(RwfPermissions.PLAY))
                .then(
                    Commands.argument("map", StringArgumentType.word())
                        .suggests(suggest(this::ballotIds))
                        .executes(
                            ctx ->
                                asPlayer(
                                    ctx,
                                    player ->
                                        runner
                                            .visitCandidate(
                                                player, StringArgumentType.getString(ctx, "map"))
                                            .ifPresent(error -> Texts.error(player, error))))))
        .then(
            Commands.literal("return")
                .requires(permission(RwfPermissions.PLAY))
                .executes(ctx -> asPlayer(ctx, runner::returnFromCandidate)))
        .then(
            Commands.literal("vote")
                .requires(permission(RwfPermissions.VOTE))
                .executes(ctx -> ballot(ctx.getSource().getSender()))
                .then(
                    Commands.argument("map", StringArgumentType.word())
                        .suggests(suggest(this::ballotIds))
                        .executes(
                            ctx ->
                                asPlayer(
                                    ctx,
                                    player ->
                                        vote(player, StringArgumentType.getString(ctx, "map"))))))
        .then(
            Commands.literal("time")
                .requires(permission(RwfPermissions.PLAY).or(permission(RwfPermissions.SPECTATE)))
                .executes(ctx -> time(ctx.getSource().getSender())))
        .then(
            Commands.literal("teamchat")
                .requires(permission(RwfPermissions.PLAY))
                .executes(ctx -> asPlayer(ctx, teamChat::toggle)))
        .then(
            Commands.literal("who")
                .requires(permission(RwfPermissions.PLAY))
                .executes(ctx -> who(ctx.getSource().getSender())))
        .then(
            Commands.literal("size")
                .requires(permission(RwfPermissions.PLAY))
                .executes(ctx -> size(ctx.getSource().getSender())))
        .then(
            Commands.literal("settings")
                .requires(permission(RwfPermissions.PLAY).or(permission(RwfPermissions.SPECTATE)))
                .executes(ctx -> experience.read(ctx.getSource().getSender())))
        .then(admin())
        .build();
  }

  private LiteralArgumentBuilder<CommandSourceStack> spectate() {
    return Commands.literal("spectate")
        .requires(permission(RwfPermissions.SPECTATE))
        .executes(ctx -> asPlayer(ctx, this::spectate))
        .then(
            Commands.literal("next")
                .executes(
                    ctx ->
                        asPlayer(
                            ctx,
                            player ->
                                spectating
                                    .cycle(player, 1)
                                    .ifPresent(message -> Texts.error(player, message)))))
        .then(
            Commands.literal("previous")
                .executes(
                    ctx ->
                        asPlayer(
                            ctx,
                            player ->
                                spectating
                                    .cycle(player, -1)
                                    .ifPresent(message -> Texts.error(player, message)))));
  }

  private LiteralArgumentBuilder<CommandSourceStack> admin() {
    return Commands.literal("admin")
        .requires(permission(RwfPermissions.ADMIN))
        .then(sizeCommand())
        .then(experience.admin())
        .then(Commands.literal("status").executes(ctx -> status(ctx.getSource().getSender())))
        .then(Commands.literal("repair").executes(ctx -> repair(ctx.getSource().getSender())))
        .then(
            Commands.literal("loadtest")
                .then(
                    Commands.argument(
                            "bots", IntegerArgumentType.integer(1, config.match().maxCombatants()))
                        .executes(
                            ctx ->
                                loadTest(
                                    ctx.getSource().getSender(),
                                    IntegerArgumentType.getInteger(ctx, "bots")))))
        .then(
            Commands.literal("showcase")
                .executes(
                    ctx -> showcase(ctx.getSource().getSender(), config.match().targetCombatants()))
                .then(
                    Commands.argument(
                            "count", IntegerArgumentType.integer(2, config.match().maxCombatants()))
                        .executes(
                            ctx ->
                                showcase(
                                    ctx.getSource().getSender(),
                                    IntegerArgumentType.getInteger(ctx, "count")))))
        .then(
            run("start")
                .executes(ctx -> refusal(ctx, new MatchEvent.ForceStart(runner.now()), "Started.")))
        .then(run("stop").executes(ctx -> refusal(ctx, new MatchEvent.Stop(), "Stopped.")))
        .then(run("forcestop").executes(ctx -> forceStop(ctx.getSource().getSender())))
        .then(
            run("skip")
                .executes(ctx -> refusal(ctx, new MatchEvent.Skip(runner.now()), "Moved on.")))
        .then(
            run("extend")
                .then(
                    Commands.argument("seconds", IntegerArgumentType.integer(1, 600))
                        .executes(
                            ctx ->
                                refusal(
                                    ctx,
                                    new MatchEvent.Extend(
                                        Duration.ofSeconds(
                                            IntegerArgumentType.getInteger(ctx, "seconds"))),
                                    "Extended."))))
        .then(
            run("setmap")
                .then(
                    Commands.argument("map", StringArgumentType.word())
                        .suggests(suggest(this::mapIds))
                        .executes(
                            ctx ->
                                setMap(
                                    ctx.getSource().getSender(),
                                    StringArgumentType.getString(ctx, "map")))))
        .then(
            run("team")
                .then(
                    Commands.argument("player", StringArgumentType.word())
                        .suggests(suggest(this::memberNames))
                        .then(
                            Commands.argument("team", StringArgumentType.word())
                                .suggests(suggest(RwfCommands::teamNames))
                                .executes(
                                    ctx ->
                                        team(
                                            ctx.getSource().getSender(),
                                            StringArgumentType.getString(ctx, "player"),
                                            StringArgumentType.getString(ctx, "team"))))))
        .then(
            run("forcekit")
                .then(
                    Commands.argument("player", StringArgumentType.word())
                        .suggests(suggest(this::memberNames))
                        .then(
                            Commands.argument("kit", StringArgumentType.word())
                                .suggests(suggest(kits::kitIds))
                                .executes(
                                    ctx ->
                                        forceKit(
                                            ctx.getSource().getSender(),
                                            StringArgumentType.getString(ctx, "player"),
                                            StringArgumentType.getString(ctx, "kit"))))))
        .then(
            run("quarantine")
                .then(
                    Commands.argument("map", StringArgumentType.word())
                        .suggests(suggest(this::mapIds))
                        .executes(
                            ctx ->
                                quarantine(
                                    ctx.getSource().getSender(),
                                    StringArgumentType.getString(ctx, "map")))))
        .then(
            run("unquarantine")
                .then(
                    Commands.argument("map", StringArgumentType.word())
                        .suggests(suggest(this::mapIds))
                        .executes(
                            ctx ->
                                unquarantine(
                                    ctx.getSource().getSender(),
                                    StringArgumentType.getString(ctx, "map")))));
  }

  private static LiteralArgumentBuilder<CommandSourceStack> run(String name) {
    return Commands.literal(name).requires(permission(RwfPermissions.RUN));
  }

  private static int usage(CommandSender sender) {
    Texts.info(
        sender,
        "/rwf join, /rwf leave, /rwf kit <kit>, /rwf kits, /rwf buy <kit>, /rwf rotation, /rwf"
            + " credits, /rwf maps, /rwf visit <map>, /rwf return, /rwf vote <map>, /rwf time, /rwf who, /rwf size, /rwf teamchat, /rwf"
            + " stats, /rwf top, /rwf history, /rwf recording, /rwf settings, /rwf killstreaks, /rwf spectate [next|previous], /rwf goto <player>,"
            + " /suicide");
    return OK;
  }

  private LiteralCommandNode<CommandSourceStack> sizeCommand() {
    var command = Commands.literal("size").executes(ctx -> size(ctx.getSource().getSender()));
    for (var mode :
        java.util.List.of(
            LobbySizing.Mode.AUTO,
            LobbySizing.Mode.SMALL,
            LobbySizing.Mode.MEDIUM,
            LobbySizing.Mode.LARGE)) {
      command.then(
          Commands.literal(mode.name().toLowerCase(Locale.ROOT))
              .executes(
                  ctx -> setSize(ctx.getSource().getSender(), new LobbySizing.Selection(mode, 0))));
    }
    command.then(
        Commands.literal("team")
            .then(
                Commands.argument(
                        "players",
                        IntegerArgumentType.integer(1, config.match().maxCombatants() / 2))
                    .executes(
                        ctx ->
                            setSize(
                                ctx.getSource().getSender(),
                                new LobbySizing.Selection(
                                    LobbySizing.Mode.TEAM,
                                    IntegerArgumentType.getInteger(ctx, "players"))))));
    return command.build();
  }

  /**
   * The map lobby sizes are read from: the one being played, else the vote's choice, else the first
   * map on the ballot.
   */
  private Optional<com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition> sizingMap() {
    var current = runner.currentMap().map(MapWorld::definition);
    if (current.isPresent()) {
      return current;
    }
    return runner
        .match()
        .ballot()
        .flatMap(
            ballot ->
                ballot
                    .chosen()
                    .or(
                        () ->
                            ballot.candidates().stream().findFirst().map(Ballot.Candidate::mapId)))
        .flatMap(id -> runner.rotation().byId(id))
        .map(MapWorld::definition);
  }

  private int setSize(CommandSender sender, LobbySizing.Selection selection) {
    if (!runner.ready()) {
      Texts.error(sender, "The match is still being prepared.");
      return 0;
    }
    var teams = sizingMap().map(map -> map.teams().size()).orElse(2);
    if (selection.mode() == LobbySizing.Mode.TEAM
        && (long) selection.count() * teams > config.match().maxCombatants()) {
      Texts.error(sender, "That team size exceeds the combatant cap for this map.");
      return 0;
    }
    runner.lobbySizes().select(selection);
    Texts.info(
        sender,
        "Lobby preference saved until restart; applies when the next countdown drafts bots.");
    return size(sender);
  }

  private int size(CommandSender sender) {
    if (!runner.ready()) {
      Texts.info(sender, "The match is still being prepared.");
      return OK;
    }
    var chosen = sizingMap();
    if (chosen.isEmpty()) {
      Texts.info(sender, "The next map is not chosen yet; sizes follow it once the vote closes.");
      return OK;
    }
    var map = chosen.orElseThrow();
    var sizes = LobbySizing.recommend(map, config.match().maxCombatants());
    var teams = map.teams().size();
    Texts.info(
        sender,
        map.name()
            + ": "
            + teams
            + " teams, "
            + sizes.footprint()
            + " blocks of horizontal footprint.");
    Texts.info(
        sender,
        "Presets: small "
            + presetDescription(sizes.small(), teams)
            + ", medium "
            + presetDescription(sizes.medium(), teams)
            + ", large "
            + presetDescription(sizes.large(), teams)
            + ". Auto uses large.");
    var preference = runner.lobbySizes().selection();
    var target = runner.lobbySizes().target(map);
    Texts.info(
        sender,
        "Next draft: "
            + preference.mode().name().toLowerCase(Locale.ROOT)
            + (preference.mode() == LobbySizing.Mode.TEAM ? " " + preference.count() : "")
            + ", "
            + sizeDescription(target, teams)
            + ", up to "
            + Math.max(0, target - runner.humans())
            + " bots with "
            + runner.humans()
            + " humans. Server cap "
            + config.match().maxCombatants()
            + ".");
    if (runner.lobbySizes().drafted() > 0) {
      Texts.info(
          sender,
          "This countdown's target is already "
              + runner.lobbySizes().drafted()
              + "; changes affect the next draft.");
    }
    return OK;
  }

  private static String sizeDescription(int total, int teams) {
    return total
        + " total ("
        + total / teams
        + (total % teams == 0 ? "" : "-" + (total / teams + 1))
        + "/team)";
  }

  private String presetDescription(int total, int teams) {
    return sizeDescription(total, teams)
        + ", up to "
        + Math.max(0, total - runner.humans())
        + " bots";
  }

  private void recordingStatus(Player player) {
    runner.recordingStatus(player).forEach(line -> Texts.info(player, line));
  }

  /**
   * The managed flag decides, off the main thread; the match decides after. A match already under
   * way makes the player a watcher who joins the next one.
   */
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
          if (watchers.watching(player.getUniqueId())) {
            watchers.join(player).ifPresent(message -> Texts.error(player, message));
            return;
          }
          if (runner.underWay() && !runner.showcase()) {
            watchers
                .watchThenJoin(player)
                .ifPresentOrElse(
                    message -> Texts.error(player, message),
                    () -> Texts.info(player, "A match is under way: you join the next one."));
            return;
          }
          runner.admit(player).ifPresent(message -> Texts.error(player, message));
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
    runner.picker().pick(player, kit).ifPresent(error -> Texts.error(player, error));
  }

  /** Buys {@code kitId} at once, as the menu's CONFIRM does. */
  private void buy(Player player, String kitId) {
    var kit = KitBook.byId(kitId);
    if (kit.isEmpty()) {
      Texts.error(player, MatchError.UNKNOWN_KIT);
      return;
    }
    menus.buy(player, kit.orElseThrow(), bought -> {});
  }

  /** This week's free kits and when they change. */
  private int rotation(CommandSender sender) {
    var now = context.time().instant();
    var armory = menus.armory();
    var free = armory.rotation(now);
    Texts.info(
        sender,
        "Free this week: "
            + String.join(
                ", ",
                free.stream()
                    .map(kit -> kit.name() + " (" + kit.tier().displayName() + ")")
                    .toList())
            + ". Changes in "
            + KitMenu.left(KitMenu.until(now, armory.rotationEnds(now)))
            + ".");
    return OK;
  }

  /** The player's Red Warfare credits. */
  private void credits(Player player) {
    menus
        .armory()
        .credits(
            player.getUniqueId(),
            credits ->
                Texts.info(
                    player,
                    "You have "
                        + credits
                        + (credits == 1 ? " credit" : " credits")
                        + ". Win a match for 3, lose one for 1."));
  }

  /** {@code /suicide}: a living member in a live match dies, credited as a suicide. */
  private void killSelf(Player player) {
    if (!runner.fighting(player.getUniqueId())) {
      Texts.error(player, "You can only do that while fighting in a Search and Destroy match.");
      return;
    }
    runner.suicide(player);
  }

  private void vote(Player player, String mapId) {
    if (!runner.features().matchFlow()) {
      Texts.error(player, "Map voting is not open yet.");
      return;
    }
    runner.vote(player, mapId).ifPresent(error -> Texts.error(player, error));
  }

  private int ballot(CommandSender sender) {
    var ballot = runner.match().ballot().filter(Ballot::opened);
    if (ballot.isEmpty() || !runner.features().matchFlow()) {
      Texts.info(sender, "There is no map vote open.");
      return OK;
    }
    for (var line : LobbyDisplays.ballotLines(ballot.orElseThrow())) {
      Texts.info(sender, line);
    }
    var ids = ballot.orElseThrow().candidates().stream().map(Ballot.Candidate::mapId).toList();
    Texts.info(sender, "Vote with /rwf vote <" + String.join("|", ids) + ">.");
    return OK;
  }

  private int time(CommandSender sender) {
    var snapshot = runner.current();
    if (snapshot.isEmpty()) {
      Texts.info(sender, "The match is still being prepared.");
      return OK;
    }
    var view = snapshot.orElseThrow();
    if (runner.match().phase() instanceof Phase.Live live) {
      // Red Warfare's /time: how long the game has run and, before it starts, the poison.
      Texts.timeProgress(
              Duration.between(live.startedAt(), view.now()),
              view.poison().map(MatchSnapshot.PoisonView::untilDamage))
          .forEach(sender::sendMessage);
      return OK;
    }
    var phase = view.phase().name().toLowerCase(Locale.ROOT);
    var until =
        view.startsAt()
            .map(at -> Duration.between(view.now(), at))
            .filter(left -> !left.isNegative())
            .map(left -> ": " + left.toSeconds() + "s left");
    var poison =
        view.poison().map(p -> ", poison in " + Math.max(0, p.untilDamage().toSeconds()) + "s");
    Texts.info(sender, "Phase " + phase + until.orElse("") + poison.orElse(""));
    return OK;
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
    // Teams are dealt as the match freezes; before that everyone is in the lobby.
    if (view.teams().isEmpty() || view.combatants().stream().allMatch(c -> c.team().isEmpty())) {
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
    Texts.info(
        sender,
        "Ready: "
            + runner.ready()
            + ", phase: "
            + match.phase().getClass().getSimpleName()
            + ", features: "
            + runner.features());
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
            + runner.arriving()
            + ", playable maps: "
            + runner.rotation().playable().size());
    runner
        .currentMap()
        .ifPresent(
            map ->
                Texts.info(
                    sender,
                    "Map "
                        + map.id()
                        + " busy: "
                        + map.busy()
                        + ", cratered blocks: "
                        + map.crateredBlocks()));
    var lobby = runner.lobbyRoom();
    Texts.info(sender, "Lobby ready: " + lobby.ready() + ", busy: " + lobby.busy());
    return OK;
  }

  private int repair(CommandSender sender) {
    if (!runner.ready() || runner.match().phase().started()) {
      Texts.error(sender, "Repair only between matches, once the lobby is ready.");
      return OK;
    }
    var lobby = runner.lobbyRoom();
    var current = runner.currentMap();
    if (lobby.busy() || current.filter(MapWorld::busy).isPresent()) {
      Texts.error(sender, "The map or the lobby is already being verified or pasted.");
      return OK;
    }
    Texts.info(
        sender, "Verifying the lobby" + current.map(m -> " and " + m.id()).orElse("") + "...");
    lobby.verifyAndRepair(
        intact -> {
          Texts.info(sender, intact ? "The lobby is intact." : "Lobby repair failed; see the log.");
          current.ifPresent(
              map ->
                  map.verifyAndRepair(
                      ok ->
                          Texts.info(
                              sender,
                              ok
                                  ? "Map " + map.id() + " is intact."
                                  : "Map repair failed; see the log.")));
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
              + " bots is starting after map preparation; it counts down and plays like any match. Watch with /rwf"
              + " spectate.");
    }
    return OK;
  }

  /** Sends {@code event} as an operator; says why it was refused, or {@code done}. */
  private int refusal(CommandContext<CommandSourceStack> ctx, MatchEvent event, String done) {
    var sender = ctx.getSource().getSender();
    if (!runner.ready()) {
      Texts.error(sender, "The match is still being prepared.");
      return OK;
    }
    runner
        .handle(event)
        .ifPresentOrElse(error -> Texts.error(sender, error), () -> Texts.info(sender, done));
    return OK;
  }

  /** Stops the match even while it resets: everyone carried over is let go too. */
  private int forceStop(CommandSender sender) {
    runner.forceStop();
    Texts.info(sender, "Stopped; everyone in the match was let go.");
    return OK;
  }

  private int setMap(CommandSender sender, String mapId) {
    var map = runner.rotation().byId(mapId);
    if (map.isEmpty()) {
      Texts.error(sender, "There is no map " + mapId + " in the rotation.");
      return OK;
    }
    var definition = map.orElseThrow().definition();
    runner
        .handle(
            new MatchEvent.SetMap(
                new Ballot.Candidate(definition.id(), definition.name(), definition.author())))
        .ifPresentOrElse(
            error -> Texts.error(sender, error),
            () -> Texts.info(sender, "The next match is played on " + definition.name() + "."));
    return OK;
  }

  private int team(CommandSender sender, String name, String teamName) {
    var team =
        Arrays.stream(TeamColor.values())
            .filter(color -> color.name().equalsIgnoreCase(teamName))
            .findFirst();
    if (team.isEmpty()) {
      Texts.error(sender, "There is no team " + teamName + ".");
      return OK;
    }
    var member = runner.match().members().stream().filter(m -> m.name().equals(name)).findFirst();
    if (member.isEmpty()) {
      Texts.error(sender, Texts.describe(MatchError.NOT_A_MEMBER));
      return OK;
    }
    runner
        .handle(new MatchEvent.AssignTeam(member.orElseThrow().id(), team.orElseThrow()))
        .ifPresentOrElse(
            error -> Texts.error(sender, error),
            () ->
                Texts.info(sender, name + " plays for " + team.orElseThrow().displayName() + "."));
    return OK;
  }

  private int forceKit(CommandSender sender, String name, String kit) {
    var member = runner.match().members().stream().filter(m -> m.name().equals(name)).findFirst();
    if (member.isEmpty()) {
      Texts.error(sender, Texts.describe(MatchError.NOT_A_MEMBER));
      return OK;
    }
    runner
        .handle(new MatchEvent.ForceKit(member.orElseThrow().id(), kit))
        .ifPresentOrElse(
            error -> Texts.error(sender, error),
            () -> Texts.info(sender, name + " now uses " + kit + "."));
    return OK;
  }

  private int quarantine(CommandSender sender, String mapId) {
    try {
      if (!runner.rotation().quarantine(mapId)) {
        Texts.error(sender, "There is no map " + mapId + " in the rotation.");
        return OK;
      }
    } catch (IllegalStateException last) {
      Texts.error(sender, "The last playable map cannot be quarantined.");
      return OK;
    }
    runner
        .handle(new MatchEvent.MapQuarantined(mapId))
        .ifPresent(
            error -> {
              throw new IllegalStateException("quarantined map stayed on the ballot: " + error);
            });
    context.onMain(
        quarantines.quarantine(
            mapId, "quarantined by an operator", sender.getName(), context.time().instant()),
        ignored ->
            Texts.info(
                sender,
                mapId
                    + " is out of every ballot, across restarts, until /rwf admin unquarantine "
                    + mapId
                    + "."),
        "quarantine rwf map " + mapId);
    return OK;
  }

  private int unquarantine(CommandSender sender, String mapId) {
    if (!runner.rotation().release(mapId)) {
      Texts.error(sender, mapId + " is not quarantined by an operator.");
      return OK;
    }
    context.onMain(
        quarantines.release(mapId),
        ignored -> Texts.info(sender, mapId + " is back in the rotation."),
        "release rwf map " + mapId);
    return OK;
  }

  private Collection<String> ballotIds() {
    return runner
        .match()
        .ballot()
        .map(ballot -> ballot.candidates().stream().map(Ballot.Candidate::mapId).toList())
        .orElseGet(List::of);
  }

  private Collection<String> mapIds() {
    return runner.rotation().playable().stream().map(MapWorld::id).toList();
  }

  private Collection<String> memberNames() {
    return runner.match().members().stream().map(m -> m.name()).toList();
  }

  private Collection<String> followableNames() {
    return runner.followable().stream().map(Player::getName).toList();
  }

  private static Collection<String> teamNames() {
    return Arrays.stream(TeamColor.values()).map(c -> c.name().toLowerCase(Locale.ROOT)).toList();
  }

  static Predicate<CommandSourceStack> permission(String permission) {
    return source -> source.getSender().hasPermission(permission);
  }

  static int asPlayer(CommandContext<CommandSourceStack> ctx, Consumer<Player> action) {
    if (ctx.getSource().getSender() instanceof Player player) {
      action.accept(player);
      return OK;
    }
    Texts.error(ctx.getSource().getSender(), "Only players can do that.");
    return 0;
  }

  static SuggestionProvider<CommandSourceStack> suggest(Supplier<Collection<String>> options) {
    return (ctx, builder) -> {
      var typed = builder.getRemaining().toLowerCase(Locale.ROOT);
      options.get().stream()
          .filter(option -> option.toLowerCase(Locale.ROOT).startsWith(typed))
          .forEach(builder::suggest);
      return builder.buildFuture();
    };
  }
}
