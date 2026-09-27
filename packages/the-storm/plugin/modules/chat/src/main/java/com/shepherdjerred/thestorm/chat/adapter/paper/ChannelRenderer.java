package com.shepherdjerred.thestorm.chat.adapter.paper;

import com.shepherdjerred.thestorm.chat.app.OutgoingLine;
import io.papermc.paper.chat.ChatRenderer;
import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;

/**
 * Renders a chat event as its channel's line. The line is rendered once, before the event is sent,
 * from the cleaned text: other plugins' edits to the message component are ignored, so nothing can
 * bypass escaping. It also carries the line so the monitor listener can publish it.
 */
final class ChannelRenderer implements ChatRenderer {

  private final OutgoingLine line;
  private final Component rendered;

  ChannelRenderer(OutgoingLine line, Component rendered) {
    this.line = line;
    this.rendered = rendered;
  }

  OutgoingLine line() {
    return line;
  }

  @Override
  public Component render(
      Player source, Component sourceDisplayName, Component message, Audience viewer) {
    return rendered;
  }
}
