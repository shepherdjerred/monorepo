package com.shepherdjerred.thestorm.discord.app;

import com.shepherdjerred.thestorm.chat.app.ChatAuthor;
import com.shepherdjerred.thestorm.chat.app.ChatLine;
import com.shepherdjerred.thestorm.chat.app.GlobalChat;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.discord.domain.Advancements;
import com.shepherdjerred.thestorm.discord.domain.DiscordText;
import com.shepherdjerred.thestorm.discord.domain.InboundFilter;
import com.shepherdjerred.thestorm.discord.domain.InboundMessage;
import com.shepherdjerred.thestorm.discord.domain.MatchLength;
import com.shepherdjerred.thestorm.discord.domain.MessageTemplate;
import com.shepherdjerred.thestorm.discord.domain.PlayerList;
import com.shepherdjerred.thestorm.discord.domain.PresenceLine;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * The bridge's use cases. Game events become Discord posts; Discord messages become Global chat.
 * Methods called from JDA's threads never touch the game directly: they hop to the main thread
 * through the {@link Scheduler}.
 */
public final class DiscordRelay {

  private final DiscordConfig config;
  private final DiscordGateway gateway;
  private final Game game;
  private final LinkedAccounts accounts;
  private final Map<String, Instant> lastPing = new ConcurrentHashMap<>();
  private final Set<String> postedTownMilestones = ConcurrentHashMap.newKeySet();
  private final List<Supplier<List<SeasonalEvent>>> seasonalEvents = new CopyOnWriteArrayList<>();
  private final Map<String, DiscordCommand> commands = new ConcurrentHashMap<>();
  private final Map<String, Instant> lastUse = new ConcurrentHashMap<>();
  private final Map<String, String> activities = new java.util.HashMap<>();
  private volatile Runnable commandsChanged = () -> {};
  private boolean presencePending;
  private @Nullable String lastPresence;
  private @Nullable Instant lastPresenceAt;
  private volatile boolean stopping;

  public DiscordRelay(
      DiscordConfig config, DiscordGateway gateway, Game game, LinkedAccounts accounts) {
    this.config = config;
    this.gateway = gateway;
    this.game = game;
    this.accounts = accounts;
  }

  /** Posts a Global line to Discord, unless it came from outside the game (such as Discord). */
  public void onChatLine(ChatLine line) {
    switch (line.author()) {
      case ChatAuthor.InGame(var _, var name) ->
          post(
              config
                  .messages()
                  .chatTemplate()
                  .render(
                      Map.of(
                          "player",
                          DiscordText.forDiscord(name),
                          "message",
                          DiscordText.forDiscord(line.text()))));
      case ChatAuthor.External _ -> {
        // Relayed lines are already visible where they came from.
      }
    }
  }

  /**
   * Stops relaying Discord into the game. Called first on disable, so a message JDA delivers while
   * the module shuts down never reaches chat or the scheduler of a disabled plugin.
   */
  public void stopRelaying() {
    stopping = true;
  }

  /** Whether the bridge is shutting down and should refuse new query work. */
  public boolean isStopping() {
    return stopping;
  }

  /** Relays a Discord message into Global chat. Called on a JDA thread; dropped once stopping. */
  public void onDiscordMessage(InboundMessage message) {
    if (stopping) {
      return;
    }
    switch (InboundFilter.accept(message, config.maxInboundLength())) {
      case Result.Ok<InboundFilter.Relayed, InboundFilter.Skip>(var relayed) ->
          game.scheduler()
              .runOnMainThread(
                  () -> {
                    if (!stopping) {
                      game.chat()
                          .broadcastExternal(config.source(), relayed.author(), relayed.text());
                    }
                  });
      case Result.Err<InboundFilter.Relayed, InboundFilter.Skip> _ -> {
        // Bots (including this bridge), empty and nameless messages stay in Discord.
      }
    }
  }

  /** Posts that {@code player} joined. Main thread. */
  public void onJoin(String player) {
    post(config.messages().joinTemplate().render(Map.of("player", DiscordText.forDiscord(player))));
    refreshPresence();
  }

  /** Posts that {@code player} left. Main thread. */
  public void onLeave(String player) {
    post(
        config.messages().leaveTemplate().render(Map.of("player", DiscordText.forDiscord(player))));
    refreshPresence();
  }

  /** Posts a death, given the game's final plain death message. */
  public void onDeath(String deathMessage) {
    var text = DiscordText.forDiscord(deathMessage);
    if (!text.isEmpty()) {
      post(config.messages().deathTemplate().render(Map.of("message", text)));
    }
  }

  /**
   * Posts an advancement if it is a real, announced one.
   *
   * @param key the advancement key's path, such as {@code story/mine_stone}
   * @param title the advancement's plain title, or empty when it has no display
   * @param announced whether it has a display and the game announces it in chat
   */
  public void onAdvancement(String player, String key, String title, boolean announced) {
    if (!Advancements.shouldPost(key, !title.isEmpty(), announced)) {
      return;
    }
    post(
        config
            .messages()
            .advancementTemplate()
            .render(
                Map.of(
                    "player",
                    DiscordText.forDiscord(player),
                    "advancement",
                    DiscordText.forDiscord(title))));
  }

  /** Posts that the server woke up, then each seasonal event running now. Called on connect. */
  public void onServerStarted() {
    post(config.messages().start());
    for (var source : seasonalEvents) {
      for (var event : source.get()) {
        post(
            config
                .messages()
                .seasonalActiveTemplate()
                .render(
                    Map.of(
                        "event", DiscordText.forDiscord(event.title()),
                        "until", DiscordText.forDiscord(event.until()))));
      }
    }
  }

  /**
   * Adds the seasonal events running now to every wake post. {@code events} is called on a JDA
   * thread and must be thread-safe. A module that registers after the bot has connected misses the
   * current wake post.
   */
  public void addSeasonalEvents(Supplier<List<SeasonalEvent>> events) {
    seasonalEvents.add(events);
  }

  /** Posts a newly filed ticket. */
  public void onTicketOpened(TicketDetails ticket) {
    post(
        config
            .messages()
            .ticketOpenedTemplate()
            .render(
                Map.of(
                    "id", Long.toString(ticket.id()),
                    "server", ticket.server(),
                    "priority", ticket.priority(),
                    "category", ticket.category(),
                    "reporter", DiscordText.forDiscord(ticket.reporter()),
                    "summary", DiscordText.forDiscord(ticket.summary()))));
  }

  /** Posts a claimed ticket. */
  public void onTicketClaimed(TicketDetails ticket) {
    postTicketStaff(config.messages().ticketClaimedTemplate(), ticket);
  }

  /** Posts a resolved ticket. */
  public void onTicketResolved(TicketDetails ticket) {
    postTicketStaff(config.messages().ticketResolvedTemplate(), ticket);
  }

  /** Posts a ticket requiring human review. */
  public void onTicketEscalated(TicketDetails ticket) {
    post(
        config
            .messages()
            .ticketEscalatedTemplate()
            .render(
                Map.of(
                    "id", Long.toString(ticket.id()),
                    "server", ticket.server(),
                    "priority", ticket.priority(),
                    "summary", DiscordText.forDiscord(ticket.summary()))));
  }

  /** Posts a reopened ticket. */
  public void onTicketReopened(TicketDetails ticket) {
    post(
        config
            .messages()
            .ticketReopenedTemplate()
            .render(Map.of("id", Long.toString(ticket.id()), "server", ticket.server())));
  }

  /** Posts ticket triage evidence. */
  public void onTicketTriaged(TicketDetails ticket) {
    post(
        config
            .messages()
            .ticketTriagedTemplate()
            .render(
                Map.of(
                    "id", Long.toString(ticket.id()),
                    "server", ticket.server(),
                    "priority", ticket.priority(),
                    "evidence", DiscordText.forDiscord(ticket.evidence()))));
  }

  /** Posts that {@code player} opened an empty Search and Destroy lobby. Main thread. */
  public void onRwfLobbyOpened(String player) {
    announceLobby(
        "rwf",
        config
            .messages()
            .rwfLobbyOpenedTemplate()
            .render(Map.of("player", DiscordText.forDiscord(player))));
  }

  /** Posts that {@code player} opened an empty lobby in {@code arena}. Main thread. */
  public void onArenaLobbyOpened(String arena, String player) {
    announceLobby(
        "arena:" + arena,
        config
            .messages()
            .arenaLobbyOpenedTemplate()
            .render(
                Map.of(
                    "arena",
                    DiscordText.forDiscord(arena),
                    "player",
                    DiscordText.forDiscord(player))));
  }

  /** Posts that a rewarding boss wave began in {@code arena}. */
  public void onArenaBossWave(String arena, int wave, String boss) {
    post(
        config
            .messages()
            .arenaBossWaveTemplate()
            .render(
                Map.of(
                    "arena", DiscordText.forDiscord(arena),
                    "wave", Integer.toString(wave),
                    "boss", DiscordText.forDiscord(boss))));
  }

  /** Posts a finished arena run, as a record when it beat the arena's best. */
  public void onArenaRunEnded(ArenaRunResult run) {
    var template =
        run.arenaRecord()
            ? config.messages().arenaRecordTemplate()
            : config.messages().arenaRunEndedTemplate();
    var players =
        run.players().stream()
            .sorted(
                java.util.Comparator.comparingInt(ArenaRunResult.Player::wave)
                    .reversed()
                    .thenComparing(ArenaRunResult.Player::name, String.CASE_INSENSITIVE_ORDER))
            .map(player -> DiscordText.forDiscord(player.name()) + " (" + player.wave() + ")")
            .toList();
    var text =
        template.render(
            Map.of(
                "arena", DiscordText.forDiscord(run.arena()),
                "tier", DiscordText.forDiscord(run.tier()),
                "wave", Integer.toString(run.furthest()),
                "players", String.join(", ", players)));
    post(text);
    directMessage(run.players().stream().map(ArenaRunResult.Player::id).toList(), text);
  }

  /** Posts a newly founded town. Main thread. */
  public void onTownFounded(String town, String founder) {
    post(
        config
            .messages()
            .townFoundedTemplate()
            .render(
                Map.of(
                    "town", DiscordText.forDiscord(town),
                    "player", DiscordText.forDiscord(founder))));
  }

  /**
   * Posts a town reaching a claim milestone, once per town and milestone while the server is up.
   * Main thread.
   */
  public void onTownGrew(UUID townId, String town, int claims) {
    if (!config.milestones().townClaims().contains(claims)
        || !postedTownMilestones.add(townId + ":" + claims)) {
      return;
    }
    post(
        config
            .messages()
            .townGrewTemplate()
            .render(
                Map.of("town", DiscordText.forDiscord(town), "claims", Integer.toString(claims))));
  }

  /** Posts a completed story or questline quest. */
  public void onQuestMilestone(String player, String quest) {
    post(
        config
            .messages()
            .questMilestoneTemplate()
            .render(
                Map.of(
                    "player", DiscordText.forDiscord(player),
                    "quest", DiscordText.forDiscord(quest))));
  }

  /** Posts a skill level up that crossed a configured milestone; other level ups are dropped. */
  public void onSkillLevelUp(String player, String skill, int from, int to) {
    var milestone = config.milestones().skillMilestone(from, to);
    if (milestone == 0) {
      return;
    }
    post(
        config
            .messages()
            .skillMilestoneTemplate()
            .render(
                Map.of(
                    "player", DiscordText.forDiscord(player),
                    "skill", DiscordText.forDiscord(skill),
                    "level", Integer.toString(milestone))));
  }

  /**
   * Posts a lobby announcement, pinging the configured roles unless {@code game} pinged within the
   * cooldown.
   */
  private void announceLobby(String game, String text) {
    var ping = config.lobbyPing();
    if (ping.roles().isEmpty()) {
      post(text);
      return;
    }
    var now = this.game.time().instant();
    var last = lastPing.get(game);
    if (last != null && now.isBefore(last.plus(ping.cooldown()))) {
      post(text);
      return;
    }
    lastPing.put(game, now);
    var mentions = String.join(" ", ping.roles().stream().map(role -> "<@&" + role + ">").toList());
    gateway.ping(
        DiscordText.truncate(mentions + " " + text, DiscordText.DISCORD_LIMIT), ping.roles());
  }

  /** Posts a Search and Destroy result. */
  public void onRwfMatchEnded(RwfMatchResult result) {
    var map = DiscordText.forDiscord(result.map());
    var length = MatchLength.format(result.length());
    var text =
        result
            .winningTeam()
            .map(
                team ->
                    config
                        .messages()
                        .rwfWonTemplate()
                        .render(
                            Map.of(
                                "map",
                                map,
                                "team",
                                DiscordText.forDiscord(team),
                                "winners",
                                names(result.winners()),
                                "duration",
                                length)))
            .orElseGet(
                () ->
                    config
                        .messages()
                        .rwfDrawTemplate()
                        .render(
                            Map.of(
                                "map",
                                map,
                                "players",
                                names(result.players()),
                                "duration",
                                length)));
    post(text);
    directMessage(result.humans(), text);
  }

  /** Sends {@code text} to each of {@code players} who asked for their results by DM. */
  private void directMessage(List<UUID> players, String text) {
    var truncated = DiscordText.truncate(text, DiscordText.DISCORD_LIMIT);
    for (var player : players) {
      accounts.dmTarget(player).ifPresent(user -> gateway.dm(user, truncated));
    }
  }

  private static String names(List<String> players) {
    return String.join(
        ", ",
        players.stream()
            .sorted(String.CASE_INSENSITIVE_ORDER)
            .map(DiscordText::forDiscord)
            .toList());
  }

  private void postTicketStaff(MessageTemplate template, TicketDetails ticket) {
    post(
        template.render(
            Map.of(
                "id", Long.toString(ticket.id()),
                "server", ticket.server(),
                "staff", DiscordText.forDiscord(ticket.staff()))));
  }

  /** Built-in commands; a module may not add one with these names. */
  private static final Set<String> BUILT_IN =
      Set.of("list", "status", "baltop", "towns", "link", "unlink");

  /** The shortest gap between two presence updates, well inside Discord's rate limit. */
  static final Duration PRESENCE_INTERVAL = Duration.ofSeconds(20);

  /** Escapes player or game text for a {@link DiscordCommand} reply. */
  public static String escape(String gameText) {
    return DiscordText.forDiscord(gameText);
  }

  /**
   * Adds a module's read-only slash command. If the bot is already connected, the guild's commands
   * are registered again.
   */
  public void addCommand(DiscordCommand command) {
    if (BUILT_IN.contains(command.name())
        || commands.putIfAbsent(command.name(), command) != null) {
      throw new IllegalArgumentException("a slash command is already named " + command.name());
    }
    commandsChanged.run();
  }

  /** Every module command, by name. */
  public List<DiscordCommand> commands() {
    return commands.values().stream()
        .sorted(java.util.Comparator.comparing(DiscordCommand::name))
        .toList();
  }

  /** The module command named {@code name}, if any. */
  public java.util.Optional<DiscordCommand> command(String name) {
    return java.util.Optional.ofNullable(commands.get(name));
  }

  /**
   * Answers a module command for {@code discordUser}, unless they used it within its cooldown.
   * Called on a JDA thread.
   */
  public void answer(
      DiscordCommand command,
      Map<String, String> options,
      long discordUser,
      Consumer<String> reply) {
    if (!command.cooldown().isZero()) {
      var now = game.time().instant();
      var key = command.name() + ":" + discordUser;
      var last = lastUse.get(key);
      if (last != null && now.isBefore(last.plus(command.cooldown()))) {
        reply.accept(
            "Wait "
                + MatchLength.format(Duration.between(now, last.plus(command.cooldown())))
                + " before using /"
                + command.name()
                + " again.");
        return;
      }
      lastUse.put(key, now);
    }
    command
        .handler()
        .answer(
            new DiscordCommand.Request(options, discordUser, accounts.playerOf(discordUser)),
            reply);
  }

  /** Called by the bridge once connected, to register commands added later. */
  public void onCommandsChanged(Runnable listener) {
    commandsChanged = listener;
  }

  /**
   * Sets what {@code game} is doing for the bot's status, such as {@code S&D: 6 playing}; empty
   * when it is idle. Main thread.
   */
  public void onActivity(String game, java.util.Optional<String> summary) {
    var changed =
        summary.isPresent()
            ? !summary.orElseThrow().equals(activities.put(game, summary.orElseThrow()))
            : activities.remove(game) != null;
    if (changed) {
      refreshPresence();
    }
  }

  /**
   * Updates the bot's status soon, at most once per {@link #PRESENCE_INTERVAL}. Main thread; the
   * update itself runs on a later tick, after joins and quits have settled.
   */
  public void refreshPresence() {
    if (presencePending || stopping) {
      return;
    }
    presencePending = true;
    var now = game.time().instant();
    var wait =
        lastPresenceAt == null
            ? Duration.ZERO
            : Duration.between(now, lastPresenceAt.plus(PRESENCE_INTERVAL));
    game.scheduler()
        .runOnMainThreadLater(wait.isNegative() ? Duration.ZERO : wait, this::flushPresence);
  }

  private void flushPresence() {
    presencePending = false;
    if (stopping) {
      return;
    }
    var text = presenceText();
    if (!text.equals(lastPresence)) {
      lastPresence = text;
      lastPresenceAt = game.time().instant();
      gateway.presence(text);
    }
  }

  private String presenceText() {
    return PresenceLine.format(
        game.players().names().size(),
        List.copyOf(new java.util.TreeMap<>(activities).values()),
        config.status());
  }

  /**
   * Answers {@code /status}: who is online and what is running, read on the main thread. Called on
   * a JDA thread.
   */
  public void status(Consumer<String> reply) {
    if (stopping) {
      reply.accept(config.messages().stop());
      return;
    }
    game.scheduler()
        .runOnMainThread(
            () -> {
              var lines = new java.util.ArrayList<String>();
              lines.add(
                  PlayerList.format(
                      game.players().names(),
                      config.messages().listTemplate(),
                      config.messages().listEmptyTemplate()));
              new java.util.TreeMap<>(activities)
                  .values()
                  .forEach(activity -> lines.add("• " + DiscordText.forDiscord(activity)));
              reply.accept(
                  DiscordText.truncate(String.join("\n", lines), DiscordText.DISCORD_LIMIT));
            });
  }

  /** The message to post as the server goes to sleep. */
  public String stopMessage() {
    return config.messages().stop();
  }

  /** The bot's custom status. */
  public String status() {
    return config.status();
  }

  /**
   * Answers {@code /list}: reads the online players on the main thread, then hands the reply to
   * {@code reply} there. Called on a JDA thread; {@code reply} must be safe to call from the main
   * thread (JDA's request queue is).
   */
  public void listPlayers(Consumer<String> reply) {
    if (stopping) {
      reply.accept(config.messages().stop());
      return;
    }
    game.scheduler()
        .runOnMainThread(
            () ->
                reply.accept(
                    PlayerList.format(
                        game.players().names(),
                        config.messages().listTemplate(),
                        config.messages().listEmptyTemplate())));
  }

  private void post(String text) {
    gateway.post(DiscordText.truncate(text, DiscordText.DISCORD_LIMIT));
  }

  /**
   * The game side of the bridge.
   *
   * @param chat Global chat
   * @param scheduler the main-thread scheduler
   * @param players who is online
   * @param time the clock lobby pings cool down by
   */
  public record Game(
      GlobalChat chat, Scheduler scheduler, OnlinePlayers players, InstantSource time) {}
}
