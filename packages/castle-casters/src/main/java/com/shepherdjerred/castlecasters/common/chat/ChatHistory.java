package com.shepherdjerred.castlecasters.common.chat;

import lombok.ToString;

import java.util.SortedSet;
import java.util.TreeSet;

@ToString
public class ChatHistory {

  private final SortedSet<ChatMessage> messages;

  public ChatHistory() {
    this.messages = new TreeSet<>();
  }

  private ChatHistory(SortedSet<ChatMessage> messages) {
    this.messages = messages;
  }

  public SortedSet<ChatMessage> getMessages() {
    return new TreeSet<>(messages);
  }

  public ChatHistory addMessage(ChatMessage message) {
    var newSet = new TreeSet<>(messages);
    newSet.add(message);
    return new ChatHistory(newSet);
  }
}
