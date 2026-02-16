package com.shepherdjerred.castlecasters.common.chat;

import com.shepherdjerred.castlecasters.common.player.Player;

import java.time.Instant;

public record ChatMessage(Player sender, String message, Instant time) implements Comparable<ChatMessage> {

  @Override
  public int compareTo(ChatMessage chatMessage) {
    return time.compareTo(chatMessage.time());
  }
}
