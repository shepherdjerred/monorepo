package com.shepherdjerred.thestorm.discord.adapter.discord;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.discord.DiscordBootstrap;
import com.shepherdjerred.thestorm.discord.PlayerVisibility;
import com.shepherdjerred.thestorm.discord.domain.BridgeText;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.towns.app.TownRead;
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
import net.dv8tion.jda.api.interactions.InteractionHook;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.requests.GatewayIntent;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/** Owns the JDA session and translates Discord callbacks onto Paper's main thread. */
public final class JdaGateway extends ListenerAdapter implements AutoCloseable {

  private final ModuleContext context;
  private final DiscordBootstrap bootstrap;
  private final Wallets wallets;
  private final CrystalFormatter formatter;
  private final TownRead towns;
  private final AtomicBoolean active = new AtomicBoolean(true);
  private final AtomicBoolean failureSignaled = new AtomicBoolean();
  private volatile @Nullable JDA client;
  private volatile boolean ready;

  /** Read ports used by the bridge's slash commands. */
  public record ReadPorts(Wallets wallets, CrystalFormatter formatter, TownRead towns) {}

  public JdaGateway(ModuleContext context, DiscordBootstrap bootstrap, ReadPorts ports) {
    this.context = context;
    this.bootstrap = bootstrap;
    this.wallets = ports.wallets();
    this.formatter = ports.formatter();
    this.towns = ports.towns();
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
    for (var command :
        List.of(
            Commands.slash("list", "Show players currently online in The Storm"),
            Commands.slash("baltop", "Show the richest players in The Storm"),
            Commands.slash("towns", "Show player towns in The Storm"))) {
      event
          .getJDA()
          .upsertCommand(command.setContexts(InteractionContextType.GUILD))
          .queue(
              ignored -> context.logger().info("Discord /{} command registered", command.getName()),
              failure ->
                  context
                      .logger()
                      .error("Could not register Discord /{}", command.getName(), failure));
    }
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
    if (!active.get()
        || !(event.getName().equals("list")
            || event.getName().equals("baltop")
            || event.getName().equals("towns"))) {
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
            hook -> dispatch(event.getName(), hook),
            failure -> context.logger().error("Could not defer Discord command", failure));
  }

  private void dispatch(String name, InteractionHook hook) {
    switch (name) {
      case "list" -> list(hook);
      case "baltop" -> baltop(hook);
      case "towns" -> towns(hook);
      default -> throw new IllegalStateException("unregistered Discord command: " + name);
    }
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

  private void list(InteractionHook hook) {
    context
        .scheduler()
        .runOnMainThread(
            () -> {
              if (!active.get()) {
                reply(hook, "The Storm is going to sleep.");
                return;
              }
              var players =
                  context.plugin().getServer().getOnlinePlayers().stream()
                      .filter(PlayerVisibility::isPublic)
                      .map(player -> BridgeText.clean(player.getName()))
                      .sorted()
                      .toList();
              reply(hook, SlashReplies.players(players));
            });
  }

  private void baltop(InteractionHook hook) {
    var _ =
        wallets
            .leaderboard(10)
            .whenComplete(
                (ranked, failure) -> {
                  if (failure != null) {
                    context.logger().error("Could not load Discord /baltop", failure);
                    reply(hook, "Could not read crystal standings right now.");
                  } else if (active.get()) {
                    reply(hook, SlashReplies.baltop(ranked, formatter));
                  } else {
                    reply(hook, "The Storm is going to sleep.");
                  }
                });
  }

  private void towns(InteractionHook hook) {
    context
        .scheduler()
        .runOnMainThread(
            () -> {
              if (active.get()) {
                reply(hook, SlashReplies.towns(towns.list(10)));
              } else {
                reply(hook, "The Storm is going to sleep.");
              }
            });
  }

  private void reply(InteractionHook hook, String message) {
    hook.editOriginal(message)
        .setAllowedMentions(List.of())
        .queue(
            ignored -> {},
            failure -> context.logger().error("Could not answer Discord command", failure));
  }

  /** Queues a plain-text Discord message without allowing mentions or blocking Paper. */
  public void publish(String message) {
    var jda = client;
    if (!active.get() || !ready || jda == null) {
      return;
    }
    var channel = jda.getTextChannelById(bootstrap.channelId());
    if (channel == null) {
      context.logger().error("Discord bridge channel disappeared");
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
