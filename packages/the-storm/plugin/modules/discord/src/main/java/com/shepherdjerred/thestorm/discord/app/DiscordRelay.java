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
import com.shepherdjerred.thestorm.discord.domain.PlayerList;
import java.util.Map;
import java.util.function.Consumer;

/**
 * The bridge's use cases. Game events become Discord posts; Discord messages become Global chat.
 * Methods called from JDA's threads never touch the game directly: they hop to the main thread
 * through the {@link Scheduler}.
 */
public final class DiscordRelay {

  private final DiscordConfig config;
  private final DiscordGateway gateway;
  private final Game game;

  public DiscordRelay(DiscordConfig config, DiscordGateway gateway, Game game) {
    this.config = config;
    this.gateway = gateway;
    this.game = game;
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

  /** Relays a Discord message into Global chat. Called on a JDA thread. */
  public void onDiscordMessage(InboundMessage message) {
    switch (InboundFilter.accept(message, config.maxInboundLength())) {
      case Result.Ok<InboundFilter.Relayed, InboundFilter.Skip>(var relayed) ->
          game.scheduler()
              .runOnMainThread(
                  () ->
                      game.chat()
                          .broadcastExternal(config.source(), relayed.author(), relayed.text()));
      case Result.Err<InboundFilter.Relayed, InboundFilter.Skip> _ -> {
        // Bots (including this bridge), empty and nameless messages stay in Discord.
      }
    }
  }

  /** Posts that {@code player} joined. */
  public void onJoin(String player) {
    post(config.messages().joinTemplate().render(Map.of("player", DiscordText.forDiscord(player))));
  }

  /** Posts that {@code player} left. */
  public void onLeave(String player) {
    post(
        config.messages().leaveTemplate().render(Map.of("player", DiscordText.forDiscord(player))));
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

  /** Posts that the server woke up. Called once the bot is connected. */
  public void onServerStarted() {
    post(config.messages().start());
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
   */
  public record Game(GlobalChat chat, Scheduler scheduler, OnlinePlayers players) {}
}
