package com.shepherdjerred.thestorm.discord.adapter.discord;

import com.shepherdjerred.thestorm.discord.domain.BridgeText;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.RankedPlayer;
import com.shepherdjerred.thestorm.towns.app.TownRead;
import java.util.List;
import java.util.stream.IntStream;

/** Bounded, plain-text replies for the bridge's read-only commands. */
final class SlashReplies {

  private SlashReplies() {}

  static String players(List<String> players) {
    return players.isEmpty()
        ? "No players are online."
        : "Online (" + players.size() + "): " + String.join(", ", players);
  }

  static String baltop(List<RankedPlayer> ranked, CrystalFormatter format) {
    if (ranked.isEmpty()) {
      return "Nobody holds any crystals yet.";
    }
    return "Richest players:\n"
        + String.join(
            "\n",
            IntStream.range(0, ranked.size())
                .mapToObj(
                    index -> {
                      var player = ranked.get(index);
                      var name = player.name().orElseGet(() -> player.account().uuid().toString());
                      return (index + 1)
                          + ". "
                          + BridgeText.clean(name)
                          + " — "
                          + format.symbol(player.balance());
                    })
                .toList());
  }

  static String towns(TownRead.Listing listing) {
    if (listing.total() == 0) {
      return "No player towns have been founded yet.";
    }
    var lines =
        listing.towns().stream()
            .map(
                town ->
                    BridgeText.clean(town.name())
                        + " — "
                        + town.members()
                        + " members, "
                        + town.claims()
                        + " claims")
            .toList();
    return "Towns (" + listing.total() + "):\n" + String.join("\n", lines);
  }
}
