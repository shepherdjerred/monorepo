package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.rwfbots.app.Governor;
import com.shepherdjerred.thestorm.rwfbots.app.ThinkLoop;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.Locale;
import java.util.Optional;
import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.text.Component;
import org.bukkit.permissions.Permission;
import org.bukkit.permissions.PermissionDefault;
import org.bukkit.plugin.PluginManager;

/**
 * {@code /rwfbots debug [bot]}: the governor level, think and staleness percentiles and every bot's
 * plan, or one bot's details. For operators.
 */
public final class RwfBotsCommand {

  public static final String PERMISSION = "thestorm.rwfbots.admin";

  static final String LABEL = "RWFBOTS";

  private static final int OK = Command.SINGLE_SUCCESS;

  private final Roster roster;
  private final ThinkLoop loop;
  private final Governor governor;
  private final BotTicker ticker;
  private final Permission permission =
      new Permission(PERMISSION, "Inspect the Search and Destroy bots", PermissionDefault.OP);

  public RwfBotsCommand(Roster roster, ThinkLoop loop, Governor governor, BotTicker ticker) {
    this.roster = roster;
    this.loop = loop;
    this.governor = governor;
    this.ticker = ticker;
  }

  public void register(Commands commands) {
    commands.register(tree(), "Search and Destroy bot diagnostics: /rwfbots debug");
  }

  public void registerPermission(PluginManager manager) {
    manager.addPermission(permission);
  }

  public void unregisterPermission(PluginManager manager) {
    manager.removePermission(permission);
  }

  LiteralCommandNode<CommandSourceStack> tree() {
    return Commands.literal("rwfbots")
        .requires(source -> source.getSender().hasPermission(PERMISSION))
        .executes(ctx -> overview(ctx.getSource().getSender()))
        .then(
            Commands.literal("debug")
                .executes(ctx -> overview(ctx.getSource().getSender()))
                .then(
                    Commands.argument("bot", StringArgumentType.word())
                        .suggests(
                            (ctx, builder) -> {
                              roster.live().forEach(bot -> builder.suggest(bot.name()));
                              return builder.buildFuture();
                            })
                        .executes(
                            ctx ->
                                bot(
                                    ctx.getSource().getSender(),
                                    StringArgumentType.getString(ctx, "bot")))))
        .build();
  }

  private int overview(Audience to) {
    var stats = loop.stats();
    info(
        to,
        String.format(
            Locale.ROOT,
            "governor level %d; think p95 %.2f ms (last %.2f ms, %d jobs); staleness p95 %.1f"
                + " ticks; bot sections p95 %.2f ms; tick %d",
            governor.level(),
            stats.percentileMillis(0.95),
            stats.lastMillis(),
            stats.count(),
            ticker.stalenessP95(),
            ticker.sectionP95Millis(),
            ticker.tick()));
    var board = loop.board();
    info(
        to,
        String.format(
            Locale.ROOT,
            "board tick %d: %d thoughts, %d perceived, %d thought, %d deferred",
            board.tick(),
            board.thoughts().size(),
            board.perceived(),
            board.thought(),
            board.deferred()));
    var bots = roster.live();
    if (bots.isEmpty()) {
      info(to, "no bots in the match");
      return OK;
    }
    for (var bot : bots) {
      info(to, line(bot));
    }
    return OK;
  }

  private int bot(Audience to, String name) {
    var found = roster.live().stream().filter(bot -> bot.name().equalsIgnoreCase(name)).findFirst();
    if (found.isEmpty()) {
      to.sendMessage(HouseStyle.error(LABEL, Component.text("no bot named " + name)));
      return 0;
    }
    var bot = found.orElseThrow();
    info(to, line(bot));
    var profile = bot.profile();
    if (profile.isEmpty()) {
      info(to, "not in a live match");
      return OK;
    }
    var id = profile.orElseThrow().id();
    var thought = loop.board().of(id);
    info(
        to,
        String.format(
            Locale.ROOT,
            "epoch %d; levers: reaction %.0f ms, aim %.2f deg, cps %.1f, awareness %.0f",
            loop.epoch(id),
            profile.orElseThrow().levers().reactionMs(),
            profile.orElseThrow().levers().aimErrorDeg(),
            profile.orElseThrow().levers().cps(),
            profile.orElseThrow().levers().awarenessRadius()));
    info(
        to,
        thought
            .map(
                t ->
                    String.format(
                        Locale.ROOT,
                        "decision from tick %d (life %d): %s, target %s, %d waypoints, bomb %s,"
                            + " sees %d",
                        t.decision().snapshotTick(),
                        t.lifeEpoch(),
                        t.decision().option(),
                        t.decision().target().map(Object::toString).orElse("-"),
                        t.decision().waypoints().size(),
                        t.decision().bomb().map(Object::toString).orElse("-"),
                        t.percept().visible().size()))
            .orElse("no thought on the board yet"));
    info(
        to,
        "refusals " + bot.refusals() + bot.lastRefusal().map(r -> " (last " + r + ")").orElse(""));
    return OK;
  }

  private static String line(BotBody bot) {
    var kit = bot.drafted().kit().name().toLowerCase(Locale.ROOT);
    var team = bot.profile().map(p -> p.team().value()).orElse("-");
    return String.format(
        Locale.ROOT,
        "%s [%s, %s] plan %s (age %d ticks) skill %.2f",
        bot.name(),
        team,
        kit,
        bot.planLabel(),
        bot.decisionAge(),
        bot.drafted().personality().skill());
  }

  private static void info(Audience to, String text) {
    to.sendMessage(HouseStyle.info(LABEL, Component.text(text)));
  }

  /** For tests: the overview a sender would read, as plain lines. */
  static Optional<String> describe(Roster roster, String name) {
    return roster.live().stream()
        .filter(bot -> bot.name().equalsIgnoreCase(name))
        .findFirst()
        .map(RwfBotsCommand::line);
  }
}
