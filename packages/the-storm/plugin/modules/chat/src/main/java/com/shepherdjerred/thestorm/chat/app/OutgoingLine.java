package com.shepherdjerred.thestorm.chat.app;

import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.chat.domain.Speaker;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

/**
 * A message that passed every rule and is ready to deliver.
 *
 * @param channel where it goes
 * @param speaker who sent it
 * @param text the cleaned message
 * @param at when it was sent
 * @param members the speaker's group for town and nation chat; empty for other channels
 */
public record OutgoingLine(
    ChannelKey channel, Speaker speaker, String text, Instant at, Set<UUID> members) {

  public OutgoingLine {
    members = Set.copyOf(members);
  }
}
