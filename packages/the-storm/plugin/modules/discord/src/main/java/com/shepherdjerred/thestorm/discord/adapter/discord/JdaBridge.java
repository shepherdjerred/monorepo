package com.shepherdjerred.thestorm.discord.adapter.discord;

import com.shepherdjerred.thestorm.discord.app.DiscordCommand;
import com.shepherdjerred.thestorm.discord.app.DiscordGateway;
import com.shepherdjerred.thestorm.discord.app.DiscordReadCommands;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import com.shepherdjerred.thestorm.discord.app.Links;
import com.shepherdjerred.thestorm.discord.domain.DiscordCredentials;
import java.time.Duration;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.JDABuilder;
import net.dv8tion.jda.api.entities.Activity;
import net.dv8tion.jda.api.entities.Message;
import net.dv8tion.jda.api.entities.channel.concrete.TextChannel;
import net.dv8tion.jda.api.interactions.InteractionHook;
import net.dv8tion.jda.api.interactions.commands.OptionType;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.interactions.commands.build.OptionData;
import net.dv8tion.jda.api.interactions.commands.build.SlashCommandData;
import net.dv8tion.jda.api.requests.GatewayIntent;
import net.dv8tion.jda.api.utils.messages.MessageCreateRequest;
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

  static final int MAX_TRACKED_MESSAGES = 256;

  interface SentMessage {
    long idLong();

    void delete(Runnable onSuccess, Consumer<Throwable> onError);
  }

  interface TrackedTransport {
    boolean sendTracked(String text, Consumer<SentMessage> onSent, Consumer<Throwable> onError);

    boolean deleteById(long messageId, Runnable onSuccess, Consumer<Throwable> onError);
  }

  static final class TrackedPosts {
    private final Object lock = new Object();
    private final LinkedHashMap<UUID, Long> messageIds = new LinkedHashMap<>();
    private final LinkedHashSet<UUID> retractedBeforeAck = new LinkedHashSet<>();

    boolean onAck(UUID submissionId, long messageId) {
      synchronized (lock) {
        if (retractedBeforeAck.remove(submissionId)) {
          return true;
        }
        if (!messageIds.containsKey(submissionId) && messageIds.size() >= MAX_TRACKED_MESSAGES) {
          messageIds.pollFirstEntry();
        }
        messageIds.put(submissionId, messageId);
        return false;
      }
    }

    Optional<Long> onRetract(UUID submissionId) {
      synchronized (lock) {
        var existing = messageIds.remove(submissionId);
        if (existing != null) {
          return Optional.of(existing);
        }
        if (!retractedBeforeAck.contains(submissionId)
            && retractedBeforeAck.size() >= MAX_TRACKED_MESSAGES) {
          retractedBeforeAck.removeFirst();
        }
        retractedBeforeAck.add(submissionId);
        return Optional.empty();
      }
    }

    int trackedCount() {
      synchronized (lock) {
        return messageIds.size();
      }
    }

    int pendingRetractCount() {
      synchronized (lock) {
        return retractedBeforeAck.size();
      }
    }
  }

  private final Logger logger;
  private final Object lifecycle = new Object();
  private final AtomicReference<@Nullable JDA> jda = new AtomicReference<>();
  private final TrackedPosts trackedPosts = new TrackedPosts();
  private final TrackedTransport transport;
  private volatile @Nullable TextChannel channel;
  private volatile boolean stopped;

  public JdaBridge(Logger logger) {
    this.logger = logger;
    this.transport =
        new TrackedTransport() {
          @Override
          public boolean sendTracked(
              String text, Consumer<SentMessage> onSent, Consumer<Throwable> onError) {
            var target = channel;
            if (target == null) return false;
            quietMessage(target.sendMessage(text))
                .queue(
                    sent ->
                        onSent.accept(
                            new SentMessage() {
                              @Override
                              public long idLong() {
                                return sent.getIdLong();
                              }

                              @Override
                              public void delete(
                                  Runnable onSuccess, Consumer<Throwable> deleteError) {
                                sent.delete().queue(ignored -> onSuccess.run(), deleteError);
                              }
                            }),
                    onError);
            return true;
          }

          @Override
          public boolean deleteById(
              long messageId, Runnable onSuccess, Consumer<Throwable> onError) {
            var target = channel;
            if (target == null) return false;
            target.deleteMessageById(messageId).queue(ignored -> onSuccess.run(), onError);
            return true;
          }
        };
  }

  JdaBridge(Logger logger, TrackedTransport transport) {
    this.logger = logger;
    this.transport = transport;
  }

  /** Logs in on a virtual thread so the server never waits on Discord. */
  public void start(
      DiscordCredentials credentials,
      DiscordRelay relay,
      DiscordReadCommands commands,
      Links links) {
    Thread.ofVirtual()
        .name("storm-discord-login")
        .start(() -> {
          try {
            var client =
                JDABuilder.createLight(
                        credentials.token(),
                        GatewayIntent.GUILD_MESSAGES,
                        GatewayIntent.MESSAGE_CONTENT)
                    .setActivity(Activity.customStatus(relay.status()))
                    .addEventListeners(
                        new JdaListener(
                            this,
                            relay,
                            new JdaListener.Handlers(commands, links),
                            credentials.channelId()))
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
    relay.onCommandsChanged(() -> registerCommands(found, relay));
    registerCommands(found, relay);
  }

  /** Replaces the guild's commands with the built-in ones and every module's. */
  private void registerCommands(TextChannel found, DiscordRelay relay) {
    var commands = new java.util.ArrayList<SlashCommandData>();
    commands.add(Commands.slash("list", "Who is online on The Storm"));
    commands.add(Commands.slash("status", "Who is online and which games are running"));
    commands.add(Commands.slash("baltop", "Show the richest players in The Storm"));
    commands.add(Commands.slash("link", "Link your Discord account to your Minecraft player"));
    commands.add(Commands.slash("unlink", "Unlink your Discord account from The Storm"));
    commands.add(
        Commands.slash("towns", "Show towns, spawn and historic sites in The Storm")
            .addOptions(
                townPageOption(),
                new OptionData(OptionType.STRING, "name", "Town or historic site to inspect")));
    for (var command : relay.commands()) {
      commands.add(slash(command));
    }
    found
        .getGuild()
        .updateCommands()
        .addCommands(commands)
        .queue(
            registered -> logger.info("Discord bridge connected to #{}", found.getName()),
            error -> logger.warn("Registering Discord slash commands failed", error));
  }

  static SlashCommandData slash(DiscordCommand command) {
    var data = Commands.slash(command.name(), command.description());
    for (var option : command.options()) {
      data.addOption(OptionType.STRING, option.name(), option.description(), option.required());
    }
    return data;
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
    quietMessage(target.sendMessage(text))
        .queue(sent -> {}, error -> logger.warn("Posting to Discord failed", error));
  }

  @Override
  public void postTracked(UUID submissionId, String text) {
    var sentToChannel =
        transport.sendTracked(
            text,
            sent -> {
              if (trackedPosts.onAck(submissionId, sent.idLong())) {
                sent.delete(
                    () -> {},
                    error -> logger.warn("Deleting retracted Discord post failed", error));
              }
            },
            error -> logger.warn("Posting to Discord failed", error));
    if (!sentToChannel) {
      logger.debug("Discord is not connected; dropped a tracked post");
    }
  }

  @Override
  public void retract(UUID submissionId) {
    var messageId = trackedPosts.onRetract(submissionId);
    if (messageId.isEmpty()) {
      return;
    }
    var deleted =
        transport.deleteById(
            messageId.orElseThrow(),
            () -> {},
            error -> logger.warn("Deleting retracted Discord post failed", error));
    if (!deleted) {
      logger.debug("Discord is not connected; could not retract {}", submissionId);
    }
  }

  int trackedMessageCount() {
    return trackedPosts.trackedCount();
  }

  int pendingRetractionCount() {
    return trackedPosts.pendingRetractCount();
  }

  @Override
  public void ping(String text, java.util.List<String> roles) {
    var target = channel;
    if (target == null) {
      logger.debug("Discord is not connected; dropped a ping");
      return;
    }
    rolePing(target.sendMessage(text), roles)
        .queue(sent -> {}, error -> logger.warn("Posting to Discord failed", error));
  }

  /** Lets a lobby post notify exactly {@code roles}; users, everyone and here stay off. */
  static <R extends MessageCreateRequest<R>> R rolePing(R request, java.util.List<String> roles) {
    return request
        .setAllowedMentions(EnumSet.noneOf(Message.MentionType.class))
        .mentionRoles(roles)
        .setSuppressedNotifications(false);
  }

  @Override
  public void dm(long discordUser, String text) {
    var client = jda.get();
    if (client == null || channel == null) {
      logger.debug("Discord is not connected; dropped a direct message");
      return;
    }
    client
        .openPrivateChannelById(discordUser)
        .flatMap(dms -> quietMessage(dms.sendMessage(text)))
        .queue(sent -> {}, error -> logger.debug("A Discord direct message was refused", error));
  }

  @Override
  public void presence(String text) {
    var client = jda.get();
    if (client != null) {
      client.getPresence().setActivity(Activity.customStatus(text));
    }
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
        quietMessage(target.sendMessage(goodbye))
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

  /** Keeps feed posts visible without mentions or push/desktop notifications. */
  static <R extends MessageCreateRequest<R>> R quietMessage(R request) {
    return request
        .setAllowedMentions(EnumSet.noneOf(Message.MentionType.class))
        .setSuppressedNotifications(true);
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
