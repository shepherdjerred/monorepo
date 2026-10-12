package com.shepherdjerred.thestorm.rwf.adapter.discord;

import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.discord.app.DiscordCommand;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;

/** {@code /rwf-stats <player>}: a player's Search and Destroy record. Reads off the main thread. */
public final class RwfStatsCommand {

  private final MatchStore matches;
  private final PlayerDirectory players;
  private final ComponentLogger logger;

  public RwfStatsCommand(MatchStore matches, PlayerDirectory players, ComponentLogger logger) {
    this.matches = matches;
    this.players = players;
    this.logger = logger;
  }

  public DiscordCommand command() {
    return new DiscordCommand(
        "rwf-stats",
        "A player's Search and Destroy record",
        List.of(new DiscordCommand.Option("player", "Minecraft name", true)),
        Duration.ZERO,
        this::answer);
  }

  private void answer(DiscordCommand.Request request, Consumer<String> reply) {
    var name = request.options().get("player");
    if (name == null || name.isBlank()) {
      reply.accept("Name a player.");
      return;
    }
    var _ =
        players
            .byName(name.strip())
            .thenCompose(
                found ->
                    found
                        .map(
                            player ->
                                matches
                                    .career(player.uuid())
                                    .thenApply(career -> text(player.lastName(), career)))
                        .orElseGet(
                            () ->
                                java.util.concurrent.CompletableFuture.completedFuture(
                                    DiscordRelay.escape(name) + " has never played on The Storm.")))
            .whenComplete(
                (text, failure) -> {
                  if (failure != null) {
                    logger.error(Component.text("rwf: reading stats for Discord failed"), failure);
                    reply.accept("Could not read Search and Destroy stats right now.");
                  } else {
                    reply.accept(text);
                  }
                });
  }

  static String text(String player, MatchStore.Career career) {
    var name = "**" + DiscordRelay.escape(player) + "**";
    if (career.matches() == 0) {
      return name + " has not played Search and Destroy yet.";
    }
    var ratio =
        career.deaths() == 0
            ? Integer.toString(career.kills())
            : String.format(Locale.ROOT, "%.2f", (double) career.kills() / career.deaths());
    return String.format(
        Locale.ROOT,
        "%s: %d matches, %d wins, %d losses · %d kills, %d deaths (K/D %s)",
        name,
        career.matches(),
        career.wins(),
        career.losses(),
        career.kills(),
        career.deaths(),
        ratio);
  }
}
