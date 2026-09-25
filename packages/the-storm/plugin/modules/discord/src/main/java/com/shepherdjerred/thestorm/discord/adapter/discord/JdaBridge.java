package com.shepherdjerred.thestorm.discord.adapter.discord;

import com.shepherdjerred.thestorm.discord.app.DiscordGateway;
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
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.requests.GatewayIntent;
import net.dv8tion.jda.api.utils.messages.MessageRequest;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;

/**
 * The JDA connection. JDA runs on its own threads; this class never touches the Bukkit API. The
 * token is handed to JDA and never logged.
 */
public final class JdaBridge implements DiscordGateway {

  /** How long shutdown waits for the goodbye post and for JDA to close. */
  private static final Duration SHUTDOWN_WAIT = Duration.ofSeconds(5);

  private final Logger logger;
  private final AtomicReference<@Nullable JDA> jda = new AtomicReference<>();
  private volatile @Nullable TextChannel channel;
  private volatile boolean stopped;

  public JdaBridge(Logger logger) {
    this.logger = logger;
  }

  /** Logs in on a virtual thread so the server never waits on Discord. */
  public void start(DiscordCredentials credentials, DiscordRelay relay) {
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
                        .addEventListeners(new JdaListener(this, relay, credentials.channelId()))
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

  /** Called by JDA once connected: finds the channel, registers {@code /list}, says hello. */
  void ready(JDA client, long channelId, DiscordRelay relay) {
    var found = client.getTextChannelById(channelId);
    if (found == null) {
      logger.error(
          "Discord channel {} was not found or the bot cannot see it; the bridge is offline",
          channelId);
      return;
    }
    channel = found;
    found
        .getGuild()
        .updateCommands()
        .addCommands(Commands.slash("list", "Who is online on The Storm"))
        .queue(
            commands -> logger.info("Discord bridge connected to #{}", found.getName()),
            error -> logger.warn("Registering Discord slash commands failed", error));
    relay.onServerStarted();
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

  /**
   * Posts {@code goodbye} and disconnects, waiting a bounded time for each. Called once, from
   * module disable.
   */
  public void stop(String goodbye) {
    stopped = true;
    var target = channel;
    channel = null;
    if (target != null) {
      try {
        withoutMentions(target.sendMessage(goodbye))
            .submit()
            .get(SHUTDOWN_WAIT.toMillis(), TimeUnit.MILLISECONDS);
      } catch (ExecutionException | TimeoutException e) {
        logger.warn("Posting the sleep message to Discord failed", e);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    }
    var client = jda.getAndSet(null);
    if (client == null) {
      return;
    }
    client.shutdown();
    try {
      if (!client.awaitShutdown(SHUTDOWN_WAIT)) {
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
}
