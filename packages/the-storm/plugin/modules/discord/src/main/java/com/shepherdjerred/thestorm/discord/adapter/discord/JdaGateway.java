package com.shepherdjerred.thestorm.discord.adapter.discord;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.discord.DiscordBootstrap;
import com.shepherdjerred.thestorm.discord.PlayerVisibility;
import com.shepherdjerred.thestorm.discord.domain.BridgeText;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.JDABuilder;
import net.dv8tion.jda.api.entities.Message;
import net.dv8tion.jda.api.events.StatusChangeEvent;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.events.message.MessageReceivedEvent;
import net.dv8tion.jda.api.events.session.ReadyEvent;
import net.dv8tion.jda.api.events.session.ShutdownEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import net.dv8tion.jda.api.interactions.InteractionContextType;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.requests.GatewayIntent;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/** Owns the JDA session and translates Discord callbacks onto Paper's main thread. */
public final class JdaGateway extends ListenerAdapter implements AutoCloseable {

  private final ModuleContext context;
  private final DiscordBootstrap bootstrap;
  private final AtomicBoolean active = new AtomicBoolean(true);
  private final AtomicBoolean failureSignaled = new AtomicBoolean();
  private volatile @Nullable JDA client;
  private volatile boolean ready;

  public JdaGateway(ModuleContext context, DiscordBootstrap bootstrap) {
    this.context = context;
    this.bootstrap = bootstrap;
  }

  public void start() {
    // JDA's build starts login on its own thread and returns before the Ready event.
    client =
        JDABuilder.createLight(
                bootstrap.token(), GatewayIntent.GUILD_MESSAGES, GatewayIntent.MESSAGE_CONTENT)
            .addEventListeners(this)
            .build();
  }

  @Override
  public void onReady(ReadyEvent event) {
    if (!active.get()) {
      return;
    }
    if (event.getJDA().getTextChannelById(bootstrap.channelId()) == null) {
      failServer("Discord bridge channel is unavailable; stopping the server");
      return;
    }
    client = event.getJDA();
    ready = true;
    event
        .getJDA()
        .upsertCommand(
            Commands.slash("list", "Show players currently online in The Storm")
                .setContexts(InteractionContextType.GUILD))
        .queue(
            ignored -> context.logger().info("Discord /list command registered"),
            failure -> context.logger().error("Could not register Discord /list", failure));
    publish("The Storm is awake.");
  }

  @Override
  public void onStatusChange(StatusChangeEvent event) {
    if (event.getNewStatus() == JDA.Status.FAILED_TO_LOGIN) {
      failServer("Discord bridge login failed; stopping the server");
    }
  }

  @Override
  public void onShutdown(ShutdownEvent event) {
    failServer("Discord bridge session ended; stopping the server");
  }

  private void failServer(String message) {
    if (active.get() && failureSignaled.compareAndSet(false, true)) {
      context.logger().error(message);
      context.scheduler().runOnMainThread(context.plugin().getServer()::shutdown);
    }
  }

  @Override
  public void onMessageReceived(MessageReceivedEvent event) {
    if (!active.get()
        || !ready
        || !event.isFromGuild()
        || event.getChannel().getIdLong() != bootstrap.channelId()
        || event.getAuthor().isBot()
        || event.getMessage().isWebhookMessage()) {
      return;
    }
    var content = BridgeText.clean(event.getMessage().getContentDisplay());
    if (content.isEmpty()) {
      return;
    }
    var line = BridgeText.fromDiscord(event.getAuthor().getEffectiveName(), content);
    context
        .scheduler()
        .runOnMainThread(
            () -> {
              if (active.get()) {
                context.plugin().getServer().broadcast(Component.text(line));
              }
            });
  }

  @Override
  public void onSlashCommandInteraction(SlashCommandInteractionEvent event) {
    if (!active.get() || !event.getName().equals("list")) {
      return;
    }
    if (!event.isFromGuild() || event.getChannel().getIdLong() != bootstrap.channelId()) {
      event
          .reply("Use this command in The Storm's linked channel.")
          .setAllowedMentions(List.of())
          .setEphemeral(true)
          .queue();
      return;
    }
    event
        .deferReply(true)
        .queue(
            hook ->
                context
                    .scheduler()
                    .runOnMainThread(
                        () -> {
                          String reply;
                          if (!active.get()) {
                            reply = "The Storm is going to sleep.";
                          } else {
                            var players =
                                context.plugin().getServer().getOnlinePlayers().stream()
                                    .filter(PlayerVisibility::isPublic)
                                    .map(player -> BridgeText.clean(player.getName()))
                                    .sorted()
                                    .toList();
                            reply = listReply(players);
                          }
                          hook.editOriginal(reply)
                              .setAllowedMentions(List.of())
                              .queue(
                                  ignored -> {},
                                  failure ->
                                      context
                                          .logger()
                                          .error("Could not answer Discord /list", failure));
                        }),
            failure -> context.logger().error("Could not defer Discord /list", failure));
  }

  /** Reads player metadata on Paper's thread before forwarding an async chat event. */
  public void publishFromPlayer(Player player, String message) {
    context
        .scheduler()
        .runOnMainThread(
            () -> {
              if (player.isOnline() && PlayerVisibility.isPublic(player)) {
                publish(message);
              }
            });
  }

  private static String listReply(List<String> players) {
    return players.isEmpty()
        ? "No players are online."
        : "Online (" + players.size() + "): " + String.join(", ", players);
  }

  /** Queues a plain-text Discord message without allowing mentions or blocking Paper. */
  public void publish(String message) {
    var jda = client;
    if (!active.get() || !ready || jda == null) {
      return;
    }
    var channel = jda.getTextChannelById(bootstrap.channelId());
    if (channel == null) {
      failServer("Discord bridge channel disappeared; stopping the server");
      return;
    }
    var clean = BridgeText.clean(message);
    if (!clean.isEmpty()) {
      channel
          .sendMessage(clean)
          .setAllowedMentions(List.<Message.MentionType>of())
          .queue(
              ignored -> {},
              failure -> context.logger().error("Discord bridge send failed", failure));
    }
  }

  @Override
  public void close() {
    if (!active.compareAndSet(true, false)) {
      return;
    }
    var jda = client;
    if (jda != null) {
      if (ready) {
        var channel = jda.getTextChannelById(bootstrap.channelId());
        if (channel != null) {
          channel
              .sendMessage("The Storm is sleeping.")
              .setAllowedMentions(List.<Message.MentionType>of())
              .queue(
                  ignored -> {},
                  failure -> context.logger().error("Discord sleep notice failed", failure));
        }
      }
      jda.shutdown();
    }
  }
}
