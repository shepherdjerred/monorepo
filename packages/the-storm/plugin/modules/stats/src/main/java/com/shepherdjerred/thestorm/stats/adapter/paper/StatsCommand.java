package com.shepherdjerred.thestorm.stats.adapter.paper;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.suggestion.SuggestionsBuilder;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.core.players.PlayerVisibility;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.stats.app.PlayerStatsSummary;
import com.shepherdjerred.thestorm.stats.app.StatsConfig;
import com.shepherdjerred.thestorm.stats.app.StatsStore;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.concurrent.Executor;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.event.HoverEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Server;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.slf4j.Logger;

/**
 * Registers {@code /stats}, {@code /stats <player>}, and {@code /stats player <player>} with
 * asynchronous SQLite reads completed onto Paper's main thread.
 */
public final class StatsCommand {

  private static final String LABEL = "Stats";
  private static final String PLAYER_ARG = "player";
  private static final DateTimeFormatter UTC_STAMP =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm 'UTC'", Locale.ROOT).withZone(ZoneOffset.UTC);

  private final Server server;
  private final StatsConfig config;
  private final StatsStore store;
  private final Executor mainThread;
  private final Logger logger;

  public record Dependencies(Server server, StatsConfig config, StatsStore store) {}

  public StatsCommand(Dependencies dependencies, Executor mainThread, Logger logger) {
    this.server = dependencies.server();
    this.config = dependencies.config();
    this.store = dependencies.store();
    this.mainThread = mainThread;
    this.logger = logger;
  }

  public void register(Commands registrar) {
    registrar.register(tree(), "View server and player analytics");
  }

  private LiteralCommandNode<CommandSourceStack> tree() {
    return Commands.literal("stats")
        .executes(this::overview)
        .then(
            Commands.literal("player")
                .then(
                    Commands.argument(PLAYER_ARG, StringArgumentType.word())
                        .suggests(this::suggestVisibleHumans)
                        .executes(this::inspectPlayer)))
        .then(
            Commands.argument(PLAYER_ARG, StringArgumentType.word())
                .suggests(this::suggestVisibleHumans)
                .executes(this::inspectPlayer))
        .build();
  }

  private int overview(CommandContext<CommandSourceStack> context) {
    var sender = context.getSource().getSender();
    int onlineHumans = countVisibleHumans(sender);
    var _ =
        store
            .countPlayers()
            .whenCompleteAsync(
                (tracked, failure) -> {
                  if (!isSenderActive(sender)) {
                    return;
                  }
                  if (failure != null) {
                    logger.error("Could not count tracked players for /stats", failure);
                    sender.sendMessage(
                        HouseStyle.error(
                            LABEL, Component.text("Could not load player analytics.")));
                    return;
                  }
                  var url = config.normalizedPublicUrl();
                  var body =
                      Component.text(config.serverName() + " — ", NamedTextColor.WHITE)
                          .append(Component.text(onlineHumans + " online", HouseStyle.BRAND))
                          .append(Component.text(" · ", NamedTextColor.DARK_GRAY))
                          .append(Component.text(tracked + " tracked players", NamedTextColor.GRAY))
                          .append(Component.text(" · ", NamedTextColor.DARK_GRAY))
                          .append(clickableLink(url, "Open The Storm player analytics"));
                  sender.sendMessage(HouseStyle.info(LABEL, body));
                },
                mainThread);
    return Command.SINGLE_SUCCESS;
  }

  private int inspectPlayer(CommandContext<CommandSourceStack> context) {
    var sender = context.getSource().getSender();
    var target = StringArgumentType.getString(context, PLAYER_ARG);
    var _ =
        store
            .findPlayer(target)
            .whenCompleteAsync(
                (found, failure) -> {
                  if (!isSenderActive(sender)) {
                    return;
                  }
                  if (failure != null) {
                    logger.error("Could not load /stats for {}", target, failure);
                    sender.sendMessage(
                        HouseStyle.error(
                            LABEL, Component.text("Could not load player analytics.")));
                    return;
                  }
                  if (found.isEmpty()) {
                    sender.sendMessage(
                        HouseStyle.error(
                            LABEL, Component.text("No stats recorded for " + target + ".")));
                    return;
                  }
                  sendPlayerSummary(sender, found.orElseThrow());
                },
                mainThread);
    return Command.SINGLE_SUCCESS;
  }

  private void sendPlayerSummary(CommandSender sender, PlayerStatsSummary summary) {
    var onlinePlayer = server.getPlayer(summary.playerUuid());
    boolean showOnline =
        onlinePlayer != null
            && Humans.isHuman(onlinePlayer)
            && PlayerVisibility.visibleTo(sender, onlinePlayer);

    var header =
        Component.text(summary.playerName(), NamedTextColor.WHITE)
            .append(
                showOnline
                    ? Component.text(" (online)", NamedTextColor.GREEN)
                    : Component.text(" (offline)", NamedTextColor.DARK_GRAY));
    sender.sendMessage(HouseStyle.info(LABEL, header));

    sender.sendMessage(
        Component.text("  First seen: ", NamedTextColor.GRAY)
            .append(Component.text(formatInstant(summary.firstSeenAt()), NamedTextColor.WHITE))
            .append(Component.text(" · Last seen: ", NamedTextColor.GRAY))
            .append(Component.text(formatInstant(summary.lastSeenAt()), NamedTextColor.WHITE)));

    sender.sendMessage(
        Component.text("  Playtime: ", NamedTextColor.GRAY)
            .append(
                Component.text(formatDuration(summary.activeMs()) + " active", HouseStyle.BRAND))
            .append(
                Component.text(
                    " (" + formatDuration(summary.connectedMs()) + " connected) · ",
                    NamedTextColor.GRAY))
            .append(Component.text(summary.sessionsCount() + " sessions", NamedTextColor.WHITE)));

    var kdr =
        summary.pvpDeaths() == 0
            ? String.format(Locale.ROOT, "%.2f", (double) summary.pvpKills())
            : String.format(Locale.ROOT, "%.2f", (double) summary.pvpKills() / summary.pvpDeaths());
    sender.sendMessage(
        Component.text("  Survival PvP: ", NamedTextColor.GRAY)
            .append(
                Component.text(
                    summary.pvpKills() + "K / " + summary.pvpDeaths() + "D", NamedTextColor.WHITE))
            .append(Component.text(" (K/D " + kdr + ") · Mob kills: ", NamedTextColor.GRAY))
            .append(Component.text(Integer.toString(summary.mobKills()), NamedTextColor.WHITE)));

    var profileUrl = config.playerProfileUrl(summary.playerName());
    sender.sendMessage(
        Component.text("  Web profile: ", NamedTextColor.GRAY)
            .append(clickableLink(profileUrl, "Open " + summary.playerName() + "'s web profile")));
  }

  private static Component clickableLink(String url, String hover) {
    return Component.text(url, HouseStyle.BRAND)
        .decorate(TextDecoration.UNDERLINED)
        .clickEvent(ClickEvent.openUrl(url))
        .hoverEvent(HoverEvent.showText(Component.text(hover, NamedTextColor.GRAY)));
  }

  private java.util.concurrent.CompletableFuture<com.mojang.brigadier.suggestion.Suggestions>
      suggestVisibleHumans(CommandContext<CommandSourceStack> context, SuggestionsBuilder builder) {
    var sender = context.getSource().getSender();
    var remaining = builder.getRemaining().toLowerCase(Locale.ROOT);
    for (var online : server.getOnlinePlayers()) {
      if (Humans.isHuman(online)
          && PlayerVisibility.visibleTo(sender, online)
          && online.getName().toLowerCase(Locale.ROOT).startsWith(remaining)) {
        builder.suggest(online.getName());
      }
    }
    return builder.buildFuture();
  }

  private int countVisibleHumans(CommandSender viewer) {
    int count = 0;
    for (var player : server.getOnlinePlayers()) {
      if (Humans.isHuman(player) && PlayerVisibility.visibleTo(viewer, player)) {
        count++;
      }
    }
    return count;
  }

  private static boolean isSenderActive(CommandSender sender) {
    return !(sender instanceof Player player) || player.isOnline();
  }

  static String formatInstant(Instant instant) {
    return UTC_STAMP.format(instant);
  }

  static String formatDuration(long ms) {
    long clamped = Math.max(0L, ms);
    long totalSeconds = clamped / 1_000L;
    long hours = totalSeconds / 3_600L;
    long minutes = (totalSeconds % 3_600L) / 60L;
    long seconds = totalSeconds % 60L;
    if (hours > 0) {
      return hours + "h " + minutes + "m";
    }
    if (minutes > 0) {
      return minutes + "m " + seconds + "s";
    }
    return seconds + "s";
  }
}
