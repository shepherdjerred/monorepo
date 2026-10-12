package com.shepherdjerred.thestorm.arena.adapter.discord;

import com.shepherdjerred.thestorm.arena.app.store.LeaderboardStore;
import com.shepherdjerred.thestorm.arena.domain.arena.ArenaDefinition;
import com.shepherdjerred.thestorm.discord.app.DiscordCommand;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;

/**
 * {@code /arena-top [arena]}: one arena's ten best waves, or every arena's best. Reads the
 * leaderboard off the main thread.
 */
public final class ArenaTopCommand {

  static final int LIMIT = 10;

  private final LeaderboardStore leaderboard;
  private final List<ArenaDefinition> arenas;
  private final ComponentLogger logger;

  public ArenaTopCommand(
      LeaderboardStore leaderboard, List<ArenaDefinition> arenas, ComponentLogger logger) {
    this.leaderboard = leaderboard;
    this.arenas = List.copyOf(arenas);
    this.logger = logger;
  }

  public DiscordCommand command() {
    return new DiscordCommand(
        "arena-top",
        "Best Mob Arena waves",
        List.of(new DiscordCommand.Option("arena", "Arena name; every arena when left out", false)),
        Duration.ZERO,
        this::answer);
  }

  private void answer(DiscordCommand.Request request, Consumer<String> reply) {
    var requested = request.options().get("arena");
    if (requested == null) {
      everyArena(reply);
      return;
    }
    var key = requested.strip().toLowerCase(Locale.ROOT);
    arenas.stream()
        .filter(
            arena -> arena.id().equals(key) || arena.name().toLowerCase(Locale.ROOT).equals(key))
        .findFirst()
        .ifPresentOrElse(
            arena -> oneArena(arena, reply),
            () -> reply.accept("There is no arena called " + DiscordRelay.escape(requested) + "."));
  }

  private void oneArena(ArenaDefinition arena, Consumer<String> reply) {
    var _ =
        leaderboard
            .top(arena.id(), LIMIT)
            .whenComplete(
                (top, failure) -> {
                  if (failure != null) {
                    failed(reply, failure);
                  } else {
                    reply.accept(ArenaReplies.top(arena.name(), top));
                  }
                });
  }

  private void everyArena(Consumer<String> reply) {
    var bests = new ArrayList<CompletableFuture<List<LeaderboardStore.Standing>>>();
    arenas.forEach(arena -> bests.add(leaderboard.top(arena.id(), 1)));
    var _ =
        CompletableFuture.allOf(bests.toArray(CompletableFuture[]::new))
            .whenComplete(
                (done, failure) -> {
                  if (failure != null) {
                    failed(reply, failure);
                    return;
                  }
                  var rows = new ArrayList<ArenaReplies.Best>();
                  for (var i = 0; i < arenas.size(); i++) {
                    rows.add(new ArenaReplies.Best(arenas.get(i).name(), bests.get(i).join()));
                  }
                  reply.accept(ArenaReplies.bests(rows));
                });
  }

  private void failed(Consumer<String> reply, Throwable failure) {
    logger.error(Component.text("arena: reading the leaderboard for Discord failed"), failure);
    reply.accept("Could not read the arena leaderboard right now.");
  }
}
