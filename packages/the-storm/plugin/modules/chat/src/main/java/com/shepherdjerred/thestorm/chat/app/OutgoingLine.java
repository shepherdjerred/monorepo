package com.shepherdjerred.thestorm.chat.app;

import com.shepherdjerred.thestorm.chat.domain.AcceptedMessage;
import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.chat.domain.Speaker;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

/**
 * A channel message (or {@code /me} action) that passed every rule and is ready to deliver.
 *
 * @param channel where it goes
 * @param speaker who sent it
 * @param message the accepted text
 * @param members the speaker's town for town chat; empty for other channels
 * @param emote whether it is a {@code /me} action rather than a message
 */
public record OutgoingLine(
    ChannelKey channel,
    Speaker speaker,
    AcceptedMessage message,
    Set<UUID> members,
    boolean emote) {

  public OutgoingLine {
    members = Set.copyOf(members);
  }

  /** The cleaned text. */
  public String text() {
    return message.text();
  }

  /** When it was sent. */
  public Instant at() {
    return message.at();
  }
}
