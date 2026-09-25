package com.shepherdjerred.thestorm.discord.domain;

import java.util.List;
import java.util.Map;

/** The reply to the {@code /list} slash command. */
public final class PlayerList {

  private PlayerList() {}

  /**
   * Lists {@code names} alphabetically, escaped for Discord, with {@code list} ({@code {count}},
   * {@code {players}}), or {@code empty} when nobody is online.
   */
  public static String format(List<String> names, MessageTemplate list, MessageTemplate empty) {
    if (names.isEmpty()) {
      return empty.render(Map.of());
    }
    var players =
        names.stream().sorted(String.CASE_INSENSITIVE_ORDER).map(DiscordText::forDiscord).toList();
    return DiscordText.truncate(
        list.render(
            Map.of("count", Integer.toString(names.size()), "players", String.join(", ", players))),
        DiscordText.DISCORD_LIMIT);
  }
}
