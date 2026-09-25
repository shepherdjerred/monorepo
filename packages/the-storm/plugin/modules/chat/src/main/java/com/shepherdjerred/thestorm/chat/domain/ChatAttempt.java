package com.shepherdjerred.thestorm.chat.domain;

import java.time.Instant;

/**
 * A message a player is trying to send.
 *
 * @param speaker who is sending it
 * @param channel where it goes
 * @param text what they typed (cleaned by {@link MessageValidator} before the rules see it)
 * @param at when they sent it
 */
public record ChatAttempt(Speaker speaker, ChannelKey channel, String text, Instant at) {

  ChatAttempt withText(String replacement) {
    return new ChatAttempt(speaker, channel, replacement, at);
  }
}
