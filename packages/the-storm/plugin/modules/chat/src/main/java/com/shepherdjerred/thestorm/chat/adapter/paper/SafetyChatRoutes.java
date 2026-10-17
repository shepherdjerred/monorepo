package com.shepherdjerred.thestorm.chat.adapter.paper;

import com.shepherdjerred.thestorm.chat.app.ChatService;
import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.core.safety.ContentSafety;
import java.util.Locale;
import java.util.UUID;
import org.bukkit.Server;

/** Captures reply recipients and private audience keys before an asynchronous hold. */
public final class SafetyChatRoutes {
  private SafetyChatRoutes() {}

  public static void install(
      ContentSafety safety,
      ChatService chat,
      com.shepherdjerred.thestorm.core.module.ModuleContext context) {
    var server = context.plugin().getServer();
    safety.commandRoutes(
        (player, command) -> {
          var pieces = command.split("\\s+", 2);
          if (pieces[0].replaceFirst("^/[^:]+:", "/").equalsIgnoreCase("/r")
              && pieces.length == 2) {
            return chat.replyTarget(player)
                .map(target -> "/msg " + target.name() + " " + pieces[1])
                .orElse(command);
          }
          return command;
        });
    safety.audiences((player, text) -> audience(chat, server, player, text));
    safety.penalties(
        request ->
            java.util.concurrent.CompletableFuture.runAsync(
                () -> {
                  if (!context.time().instant().isBefore(request.deadline()))
                    throw new IllegalStateException("Safety penalty deadline exceeded");
                  chat.mute(
                      request.submission().player(),
                      java.time.Duration.ofSeconds(request.review().muteSeconds()),
                      request.review().category() + " evidence " + request.submission().id(),
                      "StormSafety");
                },
                context.scheduler().mainThread()));
    safety.mutes(
        player ->
            java.util.concurrent.CompletableFuture.supplyAsync(
                () -> !chat.ready() || chat.activeMute(player).isPresent(),
                context.scheduler().mainThread()));
  }

  private static String audience(ChatService chat, Server server, UUID player, String text) {
    var chosen = chat.profile(player).focus();
    var message = text;
    if (text.startsWith("/")) {
      var pieces = text.split("\\s+", 3);
      var label = pieces[0].substring(1).toLowerCase(Locale.ROOT).replaceFirst("^[^:]+:", "");
      if (java.util.Set.of("msg", "tell", "whisper", "w").contains(label) && pieces.length >= 2) {
        var recipient = server.getPlayerExact(pieces[1]);
        if (recipient == null) return "private-unresolved:" + player;
        var pair =
            java.util.stream.Stream.of(player.toString(), recipient.getUniqueId().toString())
                .sorted()
                .toList();
        return "dm:" + String.join(":", pair);
      }
      if (!java.util.Set.of(
              "g", "global", "war", "wc", "sc", "tc", "t", "team", "teammsg", "tm", "say", "dead",
              "me")
          .contains(label)) return "private-command:" + player + ":" + label;
      chosen =
          switch (label) {
            case "g", "global", "say" -> ChannelKey.GLOBAL;
            case "war", "wc" -> ChannelKey.WAR;
            case "sc" -> ChannelKey.STAFF;
            case "tc" -> ChannelKey.TOWN;
            case "t", "team", "teammsg", "tm" -> ChannelKey.TEAM;
            case "dead" -> ChannelKey.DEAD;
            default -> chosen;
          };
      message = pieces.length >= 2 ? text.substring(text.indexOf(' ') + 1) : "";
    }
    return chat.audience(player, chosen, message, text.startsWith("/"));
  }
}
