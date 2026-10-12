package com.shepherdjerred.thestorm.discord.app;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.PlayerLeaderboard;
import com.shepherdjerred.thestorm.towns.app.TownRead;
import java.util.Optional;
import java.util.function.Consumer;
import org.slf4j.Logger;

/** Read-only Discord slash command use cases. JDA callbacks may call these from any thread. */
public final class DiscordReadCommands {

  private static final int PAGE_SIZE = 10;

  private final PlayerLeaderboard leaderboard;
  private final CrystalFormatter formatter;
  private final TownRead towns;
  private final Scheduler scheduler;
  private final DiscordRelay relay;
  private final Logger logger;

  /** Read-only module ports needed by the Discord commands. */
  public record Ports(
      PlayerLeaderboard leaderboard,
      CrystalFormatter formatter,
      TownRead towns,
      Scheduler scheduler) {}

  public DiscordReadCommands(Ports ports, DiscordRelay relay, Logger logger) {
    this.leaderboard = ports.leaderboard();
    this.formatter = ports.formatter();
    this.towns = ports.towns();
    this.scheduler = ports.scheduler();
    this.relay = relay;
    this.logger = logger;
  }

  /** Reads the bounded crystal leaderboard from the economy's database thread. */
  public void baltop(Consumer<String> reply) {
    if (relay.isStopping()) {
      reply.accept(relay.stopMessage());
      return;
    }
    var _ =
        leaderboard
            .leaderboard(PAGE_SIZE)
            .whenComplete(
                (ranked, failure) -> {
                  if (relay.isStopping()) {
                    reply.accept(relay.stopMessage());
                  } else if (failure != null) {
                    logger.error("Could not load Discord /baltop", failure);
                    reply.accept("Could not read crystal standings right now.");
                  } else {
                    reply.accept(DiscordCommandReplies.baltop(ranked, formatter));
                  }
                });
  }

  /** Reads the bounded public town snapshot on Paper's main thread. */
  public void towns(int page, Optional<String> name, Consumer<String> reply) {
    scheduler.runOnMainThread(
        () -> {
          if (relay.isStopping()) {
            reply.accept(relay.stopMessage());
          } else {
            reply.accept(
                name.map(
                        requested ->
                            towns
                                .info(requested)
                                .map(DiscordCommandReplies::town)
                                .orElse(
                                    "That town or historic site is not in the public directory."))
                    .orElseGet(
                        () ->
                            DiscordCommandReplies.towns(
                                towns.page(page, PAGE_SIZE), page, PAGE_SIZE)));
          }
        });
  }
}
