package com.shepherdjerred.thestorm.discord.adapter.discord;

import com.shepherdjerred.thestorm.discord.app.DiscordGateway;
import com.shepherdjerred.thestorm.discord.app.DiscordReadCommands;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import com.shepherdjerred.thestorm.discord.domain.DiscordCredentials;
import java.time.Duration;
import java.util.EnumSet;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicReference;
import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.JDABuilder;
import net.dv8tion.jda.api.entities.Activity;
import net.dv8tion.jda.api.entities.Message;
import net.dv8tion.jda.api.entities.channel.concrete.TextChannel;
import net.dv8tion.jda.api.interactions.InteractionHook;
import net.dv8tion.jda.api.interactions.commands.OptionType;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.interactions.commands.build.OptionData;
import net.dv8tion.jda.api.requests.GatewayIntent;
import net.dv8tion.jda.api.utils.messages.MessageRequest;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;

/**
 * The JDA connection. JDA runs on its own threads; this class never touches the Bukkit API. The
 * token is handed to JDA and never logged.
 */
public final class JdaBridge implements DiscordGateway {

  /** How long stop waits for the goodbye post. */
  static final Duration GOODBYE_WAIT = Duration.ofSeconds(3);

  /** How long stop then waits for JDA to close before cutting it. */
  static final Duration CLOSE_WAIT = Duration.ofSeconds(2);

  private final Logger logger;
  private final Object lifecycle = new Object();
  private final AtomicReference<@Nullable JDA> jda = new AtomicReference<>();
  private volatile @Nullable TextChannel channel;
  private volatile boolean stopped;

  public JdaBridge(Logger logger) {
    this.logger = logger;
  }

  /** Logs in on a virtual thread so the server never waits on Discord. */
  public void start(
      DiscordCredentials credentials, DiscordRelay relay, DiscordReadCommands commands) {
    Thread.ofVirtual()
        .name("storm-discord-login")
        .start(
            () -> {
              try {
                var client =
                    JDABuilder.createLight(
                            credentials.token(),
                            GatewayIntent.GUILD_MESSAGES,
                            GatewayIntent.MESSAGE_CONTENT)
                        .setActivity(Activity.customStatus(relay.status()))
                        .addEventListeners(
                            new JdaListener(this, relay, commands, credentials.channelId()))
                        .build();
                jda.set(client);
                if (stopped) {
                  client.shutdownNow();
                }
              } catch (RuntimeException e) {
                logger.error("Discord login failed; the bridge is offline", e);
              }
            });
  }

  /**
   * Called by JDA once connected: finds the channel, registers the read commands, says hello. Holds
   * the lifecycle lock so the hello is queued before any goodbye, and never after one.
   */
  void ready(JDA client, long channelId, DiscordRelay relay) {
    var found = client.getTextChannelById(channelId);
    if (found == null) {
      logger.error(
          "Discord channel {} was not found or the bot cannot see it; the bridge is offline",
          channelId);
      return;
    }
    synchronized (lifecycle) {
      if (stopped) {
        return;
      }
      channel = found;
      relay.onServerStarted();
    }
    found
        .getGuild()
        .updateCommands()
        .addCommands(
            Commands.slash("list", "Who is online on The Storm"),
            Commands.slash("baltop", "Show the richest players in The Storm"),
            Commands.slash("towns", "Show towns, spawn and historic sites in The Storm")
                .addOptions(
                    townPageOption(),
                    new OptionData(OptionType.STRING, "name", "Town or historic site to inspect")))
        .queue(
            commands -> logger.info("Discord bridge connected to #{}", found.getName()),
            error -> logger.warn("Registering Discord slash commands failed", error));
  }

  /** Discord's integer range must fit the page type consumed by the listener. */
  static OptionData townPageOption() {
    return new OptionData(OptionType.INTEGER, "page", "Directory page")
        .setRequiredRange(1, Integer.MAX_VALUE);
  }

  @Override
  public void post(String text) {
    var target = channel;
    if (target == null) {
      logger.debug("Discord is not connected; dropped a post");
      return;
    }
    withoutMentions(target.sendMessage(text))
        .queue(sent -> {}, error -> logger.warn("Posting to Discord failed", error));
  }

  /** Queues {@code goodbye} and disconnects off the Paper thread. */
  public void stop(String goodbye) {
    @Nullable TextChannel target;
    synchronized (lifecycle) {
      stopped = true;
      target = channel;
      channel = null;
    }
    var client = jda.getAndSet(null);
    if (target == null && client == null) {
      return;
    }
    Thread.ofVirtual()
        .name("storm-discord-shutdown")
        .start(() -> disconnect(target, client, goodbye));
  }

  private void disconnect(@Nullable TextChannel target, @Nullable JDA client, String goodbye) {
    if (target != null) {
      try {
        withoutMentions(target.sendMessage(goodbye))
            .submit()
            .get(GOODBYE_WAIT.toMillis(), TimeUnit.MILLISECONDS);
      } catch (ExecutionException | TimeoutException e) {
        logger.warn("Posting the sleep message to Discord failed", e);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    }
    if (client == null) {
      return;
    }
    client.shutdown();
    try {
      if (!client.awaitShutdown(CLOSE_WAIT)) {
        client.shutdownNow();
      }
    } catch (InterruptedException e) {
      client.shutdownNow();
      Thread.currentThread().interrupt();
    }
  }

  static <R extends MessageRequest<R>> R withoutMentions(R request) {
    return request.setAllowedMentions(EnumSet.noneOf(Message.MentionType.class));
  }

  /** Edits an ephemeral slash-command reply without resolving mentions. */
  void editReply(InteractionHook hook, String text) {
    hook.editOriginal(text)
        .setAllowedMentions(java.util.List.of())
        .queue(
            ignored -> {}, error -> logger.warn("Answering a Discord slash command failed", error));
  }

  void logCommandFailure(String operation, Throwable failure) {
    logger.warn("Could not {}", operation, failure);
  }
}
