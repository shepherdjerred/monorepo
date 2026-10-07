package com.shepherdjerred.thestorm.discord.app;

import com.shepherdjerred.thestorm.discord.domain.DiscordText;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.RankedPlayer;
import com.shepherdjerred.thestorm.towns.app.TownRead;
import java.util.List;
import java.util.stream.IntStream;

/** Bounded plain-text replies for Discord's read-only commands. */
final class DiscordCommandReplies {

  private DiscordCommandReplies() {}

  static String baltop(List<RankedPlayer> ranked, CrystalFormatter formatter) {
    if (ranked.isEmpty()) {
      return "Nobody holds any crystals yet.";
    }
    var page =
        "Richest players:\n"
            + String.join(
                "\n",
                IntStream.range(0, ranked.size())
                    .mapToObj(
                        index -> {
                          var player = ranked.get(index);
                          var name =
                              player.name().orElseGet(() -> player.account().uuid().toString());
                          return (index + 1)
                              + ". "
                              + DiscordText.forDiscord(name)
                              + " — "
                              + DiscordText.forDiscord(formatter.symbol(player.balance()));
                        })
                    .toList());
    return DiscordText.truncate(page, DiscordText.DISCORD_LIMIT);
  }

  static String towns(TownRead.Listing listing, int number, int size) {
    if (listing.total() == 0) {
      return "The public town directory is empty.";
    }
    var pages = (listing.total() + size - 1) / size;
    if (listing.towns().isEmpty()) {
      return "Choose a town directory page from 1 to " + pages + ".";
    }
    var lines =
        listing.towns().stream()
            .map(
                town ->
                    DiscordText.forDiscord(town.name())
                        + " — "
                        + town.members()
                        + " members, "
                        + town.claims()
                        + " claims; "
                        + town.kind()
                        + "; "
                        + town.protectedChunks()
                        + " protected chunks")
            .toList();
    var page =
        "Towns ("
            + listing.total()
            + "), page "
            + number
            + "/"
            + pages
            + ":\n"
            + String.join("\n", lines);
    return DiscordText.truncate(page, DiscordText.DISCORD_LIMIT);
  }

  static String town(TownRead.TownSummary town) {
    var summary =
        town.name()
            + " — "
            + town.kind()
            + "\n"
            + town.members()
            + " members, "
            + town.claims()
            + " claims, "
            + town.protectedChunks()
            + " protected chunks\n"
            + "Custody: "
            + town.custody()
            + "\n"
            + "Boundary evidence: "
            + town.boundaries();
    return DiscordText.truncate(DiscordText.forDiscord(summary), DiscordText.DISCORD_LIMIT);
  }
}
