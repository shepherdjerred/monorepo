package com.shepherdjerred.thestorm.arena.adapter.discord;

import com.shepherdjerred.thestorm.arena.app.ArenaHeadlines;
import com.shepherdjerred.thestorm.arena.app.ArenaNotification;
import com.shepherdjerred.thestorm.arena.app.store.LeaderboardStore;
import com.shepherdjerred.thestorm.discord.app.ArenaRunResult;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import java.util.Collection;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;

/**
 * Posts arena headlines to Discord. Each arena's best wave is loaded once and then kept up to date
 * from the runs it sees, so a record is recognised without reading the database on the main thread.
 * Until an arena's best has loaded, its runs are posted without the record flag. Main thread;
 * failures are logged, never thrown.
 */
public final class ArenaDiscordPosts {

  private final ArenaHeadlines headlines = new ArenaHeadlines();
  private final Map<String, Integer> bests = new ConcurrentHashMap<>();
  private final DiscordRelay relay;
  private final ComponentLogger logger;

  private ArenaDiscordPosts(DiscordRelay relay, ComponentLogger logger) {
    this.relay = relay;
    this.logger = logger;
  }

  /** Posts for every arena in {@code arenas}, loading their bests from {@code leaderboard}. */
  public static ArenaDiscordPosts start(
      DiscordRelay relay,
      LeaderboardStore leaderboard,
      Collection<String> arenas,
      ComponentLogger logger) {
    var posts = new ArenaDiscordPosts(relay, logger);
    for (var arena : arenas) {
      var _ =
          leaderboard
              .top(arena, 1)
              .whenComplete(
                  (top, failure) -> {
                    if (failure != null) {
                      logger.error(
                          Component.text("arena: loading the " + arena + " record failed"),
                          failure);
                    } else {
                      posts.bests.merge(
                          arena,
                          top.stream().mapToInt(LeaderboardStore.Standing::wave).max().orElse(0),
                          Math::max);
                    }
                  });
    }
    return posts;
  }

  public void accept(ArenaNotification notification) {
    try {
      headlines.accept(notification).forEach(this::post);
      var setup = notification.after().setup();
      relay.onActivity("arena:" + setup.arenaId(), ArenaHeadlines.activity(notification.after()));
    } catch (RuntimeException e) {
      logger.error(Component.text("arena: posting to Discord failed"), e);
    }
  }

  private void post(ArenaHeadlines.Headline headline) {
    switch (headline) {
      case ArenaHeadlines.Headline.LobbyOpened(var arena, var player) ->
          relay.onArenaLobbyOpened(arena, player);
      case ArenaHeadlines.Headline.BossWave(var arena, var wave, var boss) ->
          relay.onArenaBossWave(arena, wave, boss);
      case ArenaHeadlines.Headline.RunEnded run -> {
        var known = bests.get(run.arenaId());
        var record = known != null && run.furthest() > known;
        bests.merge(run.arenaId(), run.furthest(), Math::max);
        relay.onArenaRunEnded(
            new ArenaRunResult(
                run.arena(),
                run.tier(),
                run.fighters().stream()
                    .map(
                        fighter ->
                            new ArenaRunResult.Player(fighter.id(), fighter.name(), fighter.wave()))
                    .toList(),
                record));
      }
    }
  }
}
