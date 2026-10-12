package com.shepherdjerred.thestorm.arena.adapter.discord;

import com.shepherdjerred.thestorm.arena.app.store.LeaderboardStore;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import java.util.ArrayList;
import java.util.List;

/** The text of arena slash command replies. */
final class ArenaReplies {

  private ArenaReplies() {}

  /** An arena and its best standing, if anyone has played it. */
  record Best(String arena, List<LeaderboardStore.Standing> top) {}

  static String top(String arena, List<LeaderboardStore.Standing> top) {
    if (top.isEmpty()) {
      return "Nobody has fought in **" + DiscordRelay.escape(arena) + "** yet.";
    }
    var lines = new ArrayList<String>();
    lines.add("**" + DiscordRelay.escape(arena) + "** best waves:");
    for (var i = 0; i < top.size(); i++) {
      var standing = top.get(i);
      lines.add(
          (i + 1) + ". " + DiscordRelay.escape(standing.name()) + " — wave " + standing.wave());
    }
    return String.join("\n", lines);
  }

  static String bests(List<Best> bests) {
    var lines = new ArrayList<String>();
    lines.add("Mob Arena records:");
    for (var best : bests) {
      var arena = "**" + DiscordRelay.escape(best.arena()) + "**";
      lines.add(
          best.top().isEmpty()
              ? arena + ": nobody yet"
              : arena
                  + ": "
                  + DiscordRelay.escape(best.top().getFirst().name())
                  + " — wave "
                  + best.top().getFirst().wave());
    }
    return String.join("\n", lines);
  }
}
