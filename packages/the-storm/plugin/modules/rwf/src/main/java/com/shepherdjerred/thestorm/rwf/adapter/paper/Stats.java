// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/managers/GameStatsManager.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.shepherdjerred.thestorm.rwf.app.store.StatsStore;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/**
 * Red Warfare's statistics for players: {@code /rwf stats [player]} shows lifetime totals, {@code
 * /rwf top [stat]} the best ten, {@code /rwf history} the last ten matches; and the leaderboard the
 * lobby shows, read again after every match. Behind the stats flag. Reads run off the main thread
 * and answer on it.
 */
final class Stats {

  /** How many rows {@code /rwf top} and {@code /rwf history} show. */
  static final int ROWS = 10;

  /** How many players each lobby leaderboard shows. */
  static final int BOARD = 5;

  /** The boards the lobby shows, in order. */
  static final List<StatsStore.Stat> BOARDS =
      List.of(StatsStore.Stat.KILLS, StatsStore.Stat.WINS, StatsStore.Stat.BEST_WIN_STREAK);

  private static final DateTimeFormatter DAY =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneOffset.UTC);

  private final MatchRunner runner;
  private final StatsStore store;
  private final PaperContext context;
  private Map<StatsStore.Stat, List<StatsStore.Totals>> leaders = Map.of();

  Stats(MatchRunner runner, StatsStore store, PaperContext context) {
    this.runner = runner;
    this.store = store;
    this.context = context;
  }

  /** Adds {@code stats}, {@code top} and {@code history} under {@code /rwf}. */
  void addTo(LiteralArgumentBuilder<CommandSourceStack> root) {
    root.then(
            Commands.literal("stats")
                .requires(RwfCommands.permission(RwfPermissions.STATS))
                .executes(ctx -> RwfCommands.asPlayer(ctx, this::own))
                .then(
                    Commands.argument("player", StringArgumentType.word())
                        .executes(
                            ctx -> {
                              of(
                                  ctx.getSource().getSender(),
                                  StringArgumentType.getString(ctx, "player"));
                              return 1;
                            })))
        .then(
            Commands.literal("top")
                .requires(RwfCommands.permission(RwfPermissions.STATS))
                .executes(
                    ctx -> {
                      top(ctx.getSource().getSender(), StatsStore.Stat.KILLS);
                      return 1;
                    })
                .then(
                    Commands.argument("stat", StringArgumentType.word())
                        .suggests(
                            RwfCommands.suggest(
                                () ->
                                    Arrays.stream(StatsStore.Stat.values())
                                        .map(s -> s.name().toLowerCase(Locale.ROOT))
                                        .toList()))
                        .executes(
                            ctx -> {
                              var name = StringArgumentType.getString(ctx, "stat");
                              var stat =
                                  Arrays.stream(StatsStore.Stat.values())
                                      .filter(s -> s.name().equalsIgnoreCase(name))
                                      .findFirst();
                              if (stat.isEmpty()) {
                                Texts.error(ctx.getSource().getSender(), "No such statistic.");
                              } else {
                                top(ctx.getSource().getSender(), stat.orElseThrow());
                              }
                              return 1;
                            })))
        .then(
            Commands.literal("history")
                .requires(RwfCommands.permission(RwfPermissions.STATS))
                .executes(ctx -> RwfCommands.asPlayer(ctx, this::history)));
  }

  private boolean open(CommandSender sender) {
    if (!runner.features().stats()) {
      Texts.error(sender, "Search and Destroy statistics are not open yet.");
      return false;
    }
    return true;
  }

  private void own(Player player) {
    if (open(player)) {
      show(player, player.getUniqueId(), player.getName());
    }
  }

  private void of(CommandSender sender, String name) {
    if (!open(sender)) {
      return;
    }
    var online = context.server().getPlayerExact(name);
    if (online != null) {
      show(sender, online.getUniqueId(), online.getName());
      return;
    }
    var cached = context.server().getOfflinePlayerIfCached(name);
    if (cached == null) {
      Texts.error(sender, "No player called " + name + " has played here.");
      return;
    }
    show(sender, cached.getUniqueId(), name);
  }

  private void show(CommandSender sender, UUID player, String name) {
    answer(
        store.totals(player),
        totals -> {
          if (totals.isEmpty()) {
            Texts.info(sender, name + " has not finished a Search and Destroy match yet.");
            return;
          }
          var t = totals.orElseThrow();
          Texts.info(sender, t.name() + ": " + t.matches() + " matches");
          Texts.info(
              sender,
              "Kills "
                  + t.kills()
                  + ", assists "
                  + t.assists()
                  + ", deaths "
                  + t.deaths()
                  + ", suicides "
                  + t.suicides());
          Texts.info(
              sender,
              "Wins "
                  + t.wins()
                  + ", losses "
                  + t.losses()
                  + ", win streak "
                  + t.winStreak()
                  + " (best "
                  + t.bestWinStreak()
                  + "), best killstreak "
                  + t.bestStreak());
          Texts.info(
              sender, "Time fighting " + t.time().toMinutes() + " min, steaks eaten " + t.steaks());
        },
        "read rwf stats of " + name);
  }

  private void top(CommandSender sender, StatsStore.Stat stat) {
    if (!open(sender)) {
      return;
    }
    answer(
        store.top(stat, ROWS),
        rows -> {
          var title = stat.name().toLowerCase(Locale.ROOT).replace('_', ' ');
          if (rows.isEmpty()) {
            Texts.info(sender, "Nobody has a " + title + " yet.");
            return;
          }
          Texts.info(sender, "Top " + title + ":");
          for (var i = 0; i < rows.size(); i++) {
            Texts.info(sender, (i + 1) + ". " + rows.get(i).name() + " " + rows.get(i).value(stat));
          }
        },
        "read the rwf leaderboard");
  }

  private void history(Player player) {
    if (!open(player)) {
      return;
    }
    answer(
        store.history(player.getUniqueId(), ROWS),
        rows -> {
          if (rows.isEmpty()) {
            Texts.info(player, "You have not finished a Search and Destroy match yet.");
            return;
          }
          for (var row : rows) {
            Texts.info(
                player,
                DAY.format(row.endedAt())
                    + " "
                    + row.mapId()
                    + " as "
                    + row.kit()
                    + ": "
                    + row.result().toLowerCase(Locale.ROOT)
                    + ", "
                    + row.kills()
                    + " kills"
                    + row.assists().map(a -> ", " + a + " assists").orElse("")
                    + ", "
                    + row.deaths()
                    + " deaths");
          }
        },
        "read the rwf history of " + player.getName());
  }

  private <T> void answer(CompletableFuture<T> read, Consumer<T> then, String what) {
    context.onMain(read, then, what);
  }

  /** Reads the lobby's leaderboards again, after a match or as the lobby opens. */
  void refreshLeaders(Runnable then) {
    CompletableFuture<Map<StatsStore.Stat, List<StatsStore.Totals>>> read =
        CompletableFuture.completedFuture(Map.of());
    for (var stat : BOARDS) {
      read =
          read.thenCombine(
              store.top(stat, BOARD),
              (sofar, top) -> {
                var next =
                    new EnumMap<StatsStore.Stat, List<StatsStore.Totals>>(StatsStore.Stat.class);
                next.putAll(sofar);
                next.put(stat, top);
                return Map.copyOf(next);
              });
    }
    context.onMain(
        read,
        next -> {
          leaders = next;
          then.run();
        },
        "read the rwf leaderboards");
  }

  /** The lobby's leaderboards as last read. */
  Map<StatsStore.Stat, List<StatsStore.Totals>> leaders() {
    return leaders;
  }
}
