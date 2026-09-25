package com.shepherdjerred.thestorm.discord.app;

import com.shepherdjerred.thestorm.discord.domain.MessageTemplate;
import java.util.List;

/**
 * What the bot posts, from {@code discord.yml}. Each message is Discord markdown with {@code
 * {name}} placeholders; the values are escaped.
 *
 * @param chat a Global chat line: {@code {player}}, {@code {message}}
 * @param join a player joined: {@code {player}}
 * @param leave a player left: {@code {player}}
 * @param death a death: {@code {message}}, the game's death message
 * @param advancement an advancement: {@code {player}}, {@code {advancement}}
 * @param start the server woke up
 * @param stop the server is going to sleep
 * @param list the {@code /list} reply: {@code {count}}, {@code {players}}
 * @param listEmpty the {@code /list} reply when nobody is online
 */
public record DiscordMessages(
    String chat,
    String join,
    String leave,
    String death,
    String advancement,
    String start,
    String stop,
    String list,
    String listEmpty) {

  public DiscordMessages {
    chatTemplate(chat);
    playerTemplate(join);
    playerTemplate(leave);
    deathTemplate(death);
    advancementTemplate(advancement);
    fixed(start);
    fixed(stop);
    listTemplate(list);
    fixed(listEmpty);
  }

  MessageTemplate chatTemplate() {
    return chatTemplate(chat);
  }

  MessageTemplate joinTemplate() {
    return playerTemplate(join);
  }

  MessageTemplate leaveTemplate() {
    return playerTemplate(leave);
  }

  MessageTemplate deathTemplate() {
    return deathTemplate(death);
  }

  MessageTemplate advancementTemplate() {
    return advancementTemplate(advancement);
  }

  MessageTemplate listTemplate() {
    return listTemplate(list);
  }

  MessageTemplate listEmptyTemplate() {
    return fixed(listEmpty);
  }

  private static MessageTemplate chatTemplate(String source) {
    return new MessageTemplate(source, List.of("player", "message"));
  }

  private static MessageTemplate playerTemplate(String source) {
    return new MessageTemplate(source, List.of("player"));
  }

  private static MessageTemplate deathTemplate(String source) {
    return new MessageTemplate(source, List.of("message"));
  }

  private static MessageTemplate advancementTemplate(String source) {
    return new MessageTemplate(source, List.of("player", "advancement"));
  }

  private static MessageTemplate listTemplate(String source) {
    return new MessageTemplate(source, List.of("count", "players"));
  }

  private static MessageTemplate fixed(String source) {
    return new MessageTemplate(source, List.of());
  }
}
