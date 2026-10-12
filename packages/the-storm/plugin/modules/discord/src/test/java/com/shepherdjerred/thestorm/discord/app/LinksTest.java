package com.shepherdjerred.thestorm.discord.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.discord.domain.PendingLinks;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.SplittableRandom;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;

final class LinksTest {

  private static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  private static final UUID BOB = UUID.fromString("00000000-0000-0000-0000-00000000000b");

  /** Keeps links in a list, completing at once. */
  private final List<Links.Link> saved = new ArrayList<>();

  private final LinkStore store =
      new LinkStore() {
        @Override
        public CompletableFuture<List<Links.Link>> all() {
          return CompletableFuture.completedFuture(List.copyOf(saved));
        }

        @Override
        public CompletableFuture<Void> link(Links.Link link, Instant at) {
          saved.removeIf(
              old -> old.player().equals(link.player()) || old.discordUser() == link.discordUser());
          saved.add(link);
          return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletableFuture<Boolean> unlinkPlayer(UUID player) {
          return CompletableFuture.completedFuture(saved.removeIf(l -> l.player().equals(player)));
        }

        @Override
        public CompletableFuture<Boolean> unlinkDiscord(long discordUser) {
          return CompletableFuture.completedFuture(
              saved.removeIf(l -> l.discordUser() == discordUser));
        }

        @Override
        public CompletableFuture<Boolean> setDms(UUID player, boolean on) {
          var found = saved.stream().filter(l -> l.player().equals(player)).findFirst();
          found.ifPresent(
              l -> {
                saved.remove(l);
                saved.add(new Links.Link(player, l.discordUser(), on));
              });
          return CompletableFuture.completedFuture(found.isPresent());
        }
      };

  private final Links links =
      new Links(
          store,
          new PendingLinks(Duration.ofMinutes(10)),
          () -> Instant.parse("2026-10-11T12:00:00Z"),
          new SplittableRandom(3));

  @Test
  void linkingTakesAValidCodeAndDmsAreOptIn() {
    assertThat(links.confirm(ALICE, "NOPE42").join()).isEmpty();

    var code = links.start(42L);
    assertThat(links.confirm(ALICE, code).join()).contains(new Links.Link(ALICE, 42L, false));
    assertThat(links.dmTarget(ALICE)).isEmpty();

    assertThat(links.setDms(ALICE, true).join()).isTrue();
    assertThat(links.dmTarget(ALICE)).contains(42L);
    assertThat(links.setDms(BOB, true).join()).isFalse();
  }

  @Test
  void aDiscordUserLinksOnePlayerAndCanUnlinkFromEitherSide() {
    links.confirm(ALICE, links.start(42L)).join();
    links.confirm(BOB, links.start(42L)).join();

    assertThat(links.of(ALICE)).isEmpty();
    assertThat(links.of(BOB)).contains(new Links.Link(BOB, 42L, false));

    assertThat(links.unlinkDiscord(42L).join()).isTrue();
    assertThat(links.of(BOB)).isEmpty();
    assertThat(links.unlink(BOB).join()).isFalse();
  }
}
