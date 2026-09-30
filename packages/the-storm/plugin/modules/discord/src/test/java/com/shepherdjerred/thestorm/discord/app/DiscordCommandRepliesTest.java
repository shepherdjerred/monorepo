package com.shepherdjerred.thestorm.discord.app;

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

final class DiscordCommandRepliesTest {

  private static final CrystalFormatter FORMATTER =
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
  void baltopShowsNamesAndBalancesWithoutDiscordFormattingOrMentions() {
    var player =
        new RankedPlayer(
            new AccountId.Player(UUID.fromString("00000000-0000-0000-0000-000000000001")),
            Optional.of("@everyone*"),
            Crystals.of(500));

    assertThat(DiscordCommandReplies.baltop(List.of(player), FORMATTER))
        .isEqualTo("Richest players:\n1. @\u200beveryone\\* — 500 CR");
  }

  @Test
  void baltopExplainsEmptyLeaderboards() {
    assertThat(DiscordCommandReplies.baltop(List.of(), FORMATTER))
        .isEqualTo("Nobody holds any crystals yet.");
  }

  @Test
  void townsShowsOnlyTheBoundedPublicSummaryAndEscapesNames() {
    var listing = new TownRead.Listing(1, List.of(new TownRead.TownSummary("<Harbor>", 3, 7)));

    assertThat(DiscordCommandReplies.towns(listing))
        .isEqualTo("Towns (1):\n\\<Harbor> — 3 members, 7 claims");
  }

  @Test
  void townsExplainsEmptyListings() {
    assertThat(DiscordCommandReplies.towns(new TownRead.Listing(0, List.of())))
        .isEqualTo("No player towns have been founded yet.");
  }
}
