package com.shepherdjerred.thestorm.discord.adapter.discord;

import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import com.shepherdjerred.thestorm.discord.domain.InboundMessage;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.events.message.MessageReceivedEvent;
import net.dv8tion.jda.api.events.session.ReadyEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;

/** Turns JDA events into relay calls. Runs on JDA's threads. */
final class JdaListener extends ListenerAdapter {

  private final JdaBridge bridge;
  private final DiscordRelay relay;
  private final long channelId;

  JdaListener(JdaBridge bridge, DiscordRelay relay, long channelId) {
    this.bridge = bridge;
    this.relay = relay;
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
    if (!"list".equals(event.getName())) {
      return;
    }
    event.deferReply().queue();
    relay.listPlayers(
        reply -> JdaBridge.withoutMentions(event.getHook().sendMessage(reply)).queue());
  }
}
