package com.shepherdjerred.thestorm.agent.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.chat.app.ChatAuthor;
import com.shepherdjerred.thestorm.chat.app.ChatLine;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class RecentChatTest {

  private static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  private static final UUID BOB = UUID.fromString("00000000-0000-0000-0000-00000000000b");
  private static final Instant NOW = Instant.parse("2017-06-01T12:00:00Z");

  private static ChatLine line(UUID player, String name, String text) {
    return new ChatLine(NOW, new ChatAuthor.InGame(player, name), text);
  }

  @Test
  void readsNewestFirstWithLimits() {
    var recents = new RecentChat();
    recents.record(line(ALICE, "Alice", "first"));
    recents.record(line(BOB, "Bob", "second"));
    recents.record(line(ALICE, "Alice", "third"));

    assertThat(recents.last(10))
        .extracting(ChatLine::text)
        .containsExactly("third", "second", "first");
    assertThat(recents.last(2)).extracting(ChatLine::text).containsExactly("third", "second");
    assertThat(recents.lastBy(ALICE, 10))
        .extracting(ChatLine::text)
        .containsExactly("third", "first");
    assertThat(recents.lastBy(BOB, 10)).extracting(ChatLine::text).containsExactly("second");
  }

  @Test
  void skipsRelayedLinesByPlayer() {
    var recents = new RecentChat();
    recents.record(new ChatLine(NOW, new ChatAuthor.External("D", "Dee"), "hi from discord"));

    assertThat(recents.last(10)).hasSize(1);
    assertThat(recents.lastBy(ALICE, 10)).isEmpty();
  }

  @Test
  void dropsTheOldestPastCapacity() {
    var recents = new RecentChat();
    for (var i = 0; i < RecentChat.CAPACITY + 2; i++) {
      recents.record(line(ALICE, "Alice", "line " + i));
    }

    var kept = recents.last(RecentChat.CAPACITY + 10);
    assertThat(kept).hasSize(RecentChat.CAPACITY);
    assertThat(kept.getFirst().text()).isEqualTo("line " + (RecentChat.CAPACITY + 1));
    assertThat(kept.getLast().text()).isEqualTo("line 2");
  }
}
