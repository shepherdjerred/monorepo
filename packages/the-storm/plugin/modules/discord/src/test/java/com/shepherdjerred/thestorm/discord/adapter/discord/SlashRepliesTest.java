package com.shepherdjerred.thestorm.discord.adapter.discord;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.RankedPlayer;
import com.shepherdjerred.thestorm.towns.app.TownRead;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class SlashRepliesTest {

  private static final CrystalFormatter FORMAT =
      new CrystalFormatter() {
        @Override
        public String words(Crystals amount) {
          return amount.amount() + " crystals";
        }

        @Override
        public String symbol(Crystals amount) {
          return amount.amount() + " CR";
        }
      };

  @Test
  void leaderboardUsesRecordedNamesAndBalances() {
    var player =
        new RankedPlayer(
            new AccountId.Player(UUID.randomUUID()), Optional.of("StormFan"), new Crystals(125));
    assertThat(SlashReplies.baltop(List.of(player), FORMAT))
        .isEqualTo("Richest players:\n1. StormFan — 125 CR");
    assertThat(SlashReplies.baltop(List.of(), FORMAT)).isEqualTo("Nobody holds any crystals yet.");
  }

  @Test
  void townReplyShowsPublicCountsAndFullTotal() {
    var listing = new TownRead.Listing(12, List.of(new TownRead.TownSummary("Aegis", 3, 8)));
    assertThat(SlashReplies.towns(listing)).isEqualTo("Towns (12):\nAegis — 3 members, 8 claims");
    assertThat(SlashReplies.towns(new TownRead.Listing(0, List.of())))
        .isEqualTo("No player towns have been founded yet.");
  }
}
