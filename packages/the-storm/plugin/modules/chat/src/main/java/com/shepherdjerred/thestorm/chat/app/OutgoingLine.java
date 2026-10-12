package com.shepherdjerred.thestorm.chat.app;

import com.shepherdjerred.thestorm.chat.domain.AcceptedMessage;
import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.chat.domain.Speaker;
import java.time.Instant;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * A channel message (or {@code /me} action) that passed every rule and is ready to deliver.
 *
 * @param channel where it goes
 * @param speaker who sent it
 * @param message the accepted text
 * @param members the speaker's group for a membership channel; empty for other channels
 * @param emote whether it is a {@code /me} action rather than a message
 * @param npc the NPC's own trusted prefix when an NPC said it through {@link NpcChat}; empty for a
 *     player
 */
public record OutgoingLine(
    ChannelKey channel,
    Speaker speaker,
    AcceptedMessage message,
    Set<UUID> members,
    boolean emote,
    Optional<String> npc) {

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

  /** Whether an NPC said it. */
  public boolean byNpc() {
    return npc.isPresent();
  }
}
