package com.shepherdjerred.thestorm.discord.adapter.discord;

import com.shepherdjerred.thestorm.discord.app.DiscordCommand;
import com.shepherdjerred.thestorm.discord.app.DiscordReadCommands;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import com.shepherdjerred.thestorm.discord.app.Links;
import com.shepherdjerred.thestorm.discord.domain.InboundMessage;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Consumer;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.events.message.MessageReceivedEvent;
import net.dv8tion.jda.api.events.session.ReadyEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import org.jspecify.annotations.Nullable;

/** Turns JDA events into relay calls. Runs on JDA's threads. */
final class JdaListener extends ListenerAdapter {

  private final JdaBridge bridge;
  private final DiscordRelay relay;
  private final Handlers handlers;
  private final long channelId;

  /**
   * What answers the commands besides the relay.
   *
   * @param commands the read-only commands
   * @param links account linking
   */
  record Handlers(DiscordReadCommands commands, Links links) {}

  JdaListener(JdaBridge bridge, DiscordRelay relay, Handlers handlers, long channelId) {
    this.bridge = bridge;
    this.relay = relay;
    this.handlers = handlers;
    this.channelId = channelId;
  }

  @Override
  public void onReady(ReadyEvent event) {
    bridge.ready(event.getJDA(), channelId, relay);
  }

  @Override
  public void onMessageReceived(MessageReceivedEvent event) {
    if (event.getChannel().getIdLong() != channelId) {
      return;
    }
    var message = event.getMessage();
    var member = event.getMember();
    var author = member != null ? member.getEffectiveName() : event.getAuthor().getEffectiveName();
    relay.onDiscordMessage(
        new InboundMessage(
            author,
            message.getContentDisplay(),
            event.getAuthor().isBot() || event.isWebhookMessage(),
            message.getAttachments().size()));
  }

  @Override
  public void onSlashCommandInteraction(SlashCommandInteractionEvent event) {
    switch (event.getName()) {
      case "list" -> {
        event.deferReply().queue();
        relay.listPlayers(reply -> publicReply(event, reply));
      }
      case "status" -> {
        event.deferReply().queue();
        relay.status(reply -> publicReply(event, reply));
      }
      case "link" -> link(event);
      case "unlink" -> unlink(event);
      case "baltop" -> inChannel(event, reply -> handlers.commands().baltop(reply));
      case "towns" ->
          inChannel(
              event,
              reply ->
                  handlers
                      .commands()
                      .towns(
                          event.getOption("page", 1, option -> option.getAsInt()),
                          Optional.ofNullable(
                              event.getOption("name", option -> option.getAsString())),
                          reply));
      default -> relay.command(event.getName()).ifPresent(command -> module(event, command));
    }
  }

  private static void publicReply(SlashCommandInteractionEvent event, String reply) {
    JdaBridge.quietMessage(event.getHook().sendMessage(reply)).queue();
  }

  private void module(SlashCommandInteractionEvent event, DiscordCommand command) {
    var options = new HashMap<String, String>();
    event.getOptions().forEach(option -> options.put(option.getName(), option.getAsString()));
    inChannel(event, reply -> command.handler().answer(Map.copyOf(options), reply));
  }

  /** Answers privately, in the linked channel only, with the sleep message once stopping. */
  private void inChannel(SlashCommandInteractionEvent event, Consumer<Consumer<String>> answer) {
    if (!event.isFromGuild() || event.getChannel().getIdLong() != channelId) {
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
                answer.accept(
                    text ->
                        bridge.editReply(hook, relay.isStopping() ? relay.stopMessage() : text)),
            error -> bridge.logCommandFailure("deferring Discord read command", error));
  }

  private void link(SlashCommandInteractionEvent event) {
    var links = handlers.links();
    var code = links.start(event.getUser().getIdLong());
    event
        .reply(
            "Type `/discord link "
                + code
                + "` in game on ts-mc.net within "
                + links.codeMinutes()
                + " minutes.")
        .setAllowedMentions(List.of())
        .setEphemeral(true)
        .queue();
  }

  private void unlink(SlashCommandInteractionEvent event) {
    event
        .deferReply(true)
        .queue(
            hook -> {
              var _ =
                  handlers
                      .links()
                      .unlinkDiscord(event.getUser().getIdLong())
                      .whenComplete(
                          (removed, failure) -> bridge.editReply(hook, unlinked(removed, failure)));
            },
            error -> bridge.logCommandFailure("deferring Discord unlink", error));
  }

  private static String unlinked(@Nullable Boolean removed, @Nullable Throwable failure) {
    if (failure != null || removed == null) {
      return "Could not unlink right now.";
    }
    return removed
        ? "Your Discord account is no longer linked."
        : "Your Discord account is not linked.";
  }
}
