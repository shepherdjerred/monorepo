package com.shepherdjerred.thestorm.core.analytics;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class SessionBookTest {
  static final class Time implements InstantSource {
    private Instant now = Instant.parse("2026-10-10T06:59:30Z");

    @Override
    public Instant instant() {
      return now;
    }

    void advance(long seconds) {
      now = now.plusSeconds(seconds);
    }
  }

  @Test
  void accountsForAfkModesAndPacificMidnightWithoutDoubleCounting() {
    var time = new Time();
    var writes = new ArrayList<AnalyticsWrite>();
    var book = new SessionBook(time, UUID::randomUUID, writes::add);
    var player = UUID.randomUUID();
    book.joined(player, "Player");
    book.joined(player, "Player");
    time.advance(45);
    book.checkpoint();
    book.afk(player, true);
    time.advance(15);
    book.mode(player, ProductAnalytics.Mode.ARENA);
    time.advance(20);
    book.afk(player, false);
    time.advance(10);
    book.interaction(player, ProductAnalytics.Action.SHOP_BOUGHT);
    book.left(player, "disconnect");
    book.left(player, "disconnect");
    book.checkpoint();

    var events = writes.stream().flatMap(write -> write.events().stream()).toList();
    assertThat(events.stream().filter(event -> event.event().equals("storm_session_started")))
        .hasSize(1);
    var intervals =
        events.stream().filter(event -> event.event().equals("storm_playtime_recorded")).toList();
    assertThat(intervals).hasSize(5);
    assertThat(intervals.getFirst().properties())
        .containsEntry("connected_ms", 30000L)
        .containsEntry("interval_end", "2026-10-10T07:00:00Z");
    assertThat(
            intervals.stream()
                .mapToLong(event -> (Long) event.properties().get("connected_ms"))
                .sum())
        .isEqualTo(90000);
    assertThat(
            intervals.stream().mapToLong(event -> (Long) event.properties().get("active_ms")).sum())
        .isEqualTo(55000);
    assertThat(
            intervals.stream()
                .filter(event -> "arena".equals(event.properties().get("mode")))
                .mapToLong(event -> (Long) event.properties().get("connected_ms"))
                .sum())
        .isEqualTo(30000);
    assertThat(events.getLast().properties())
        .containsEntry("connected_ms", 90000L)
        .containsEntry("active_ms", 55000L);
    assertThat(
            events.stream()
                .filter(event -> event.event().equals("storm_feature_interacted"))
                .findFirst()
                .orElseThrow()
                .properties())
        .containsEntry("mode", "arena")
        .containsEntry("feature", "shops")
        .containsEntry("action", "bought");
    assertThat(events.stream().map(AnalyticsEvent::id).distinct().count()).isEqualTo(events.size());
    assertThat(writes.getLast().connection().ended()).isTrue();
  }

  @Test
  void ignoresUnknownPlayersAndFlushesOpenConnectionsOnShutdown() {
    var time = new Time();
    var writes = new ArrayList<AnalyticsWrite>();
    var book = new SessionBook(time, UUID::randomUUID, writes::add);
    var player = UUID.randomUUID();
    book.interaction(player, ProductAnalytics.Action.SPELL_CAST);
    book.afk(player, true);
    book.mode(player, ProductAnalytics.Mode.ARENA);
    assertThat(writes).isEmpty();
    book.joined(player, "Player");
    time.advance(60);
    book.stop();
    book.stop();
    assertThat(writes.getLast().events().getLast().properties())
        .containsEntry("end_reason", "shutdown")
        .containsEntry("connected_ms", 60000L);
  }

  @Test
  void pacificDaySplitHandlesDaylightSavingTransition() {
    var time = new Time();
    time.now = Instant.parse("2026-11-01T07:00:00Z");
    var writes = new ArrayList<AnalyticsWrite>();
    var book = new SessionBook(time, UUID::randomUUID, writes::add);
    book.joined(UUID.randomUUID(), "Player");
    time.advance(25 * 3600L + 60);
    book.checkpoint();
    var intervals = writes.getLast().events();
    assertThat(intervals).hasSize(2);
    assertThat(intervals.getFirst().properties()).containsEntry("connected_ms", 90000000L);
    assertThat(intervals.getLast().properties()).containsEntry("connected_ms", 60000L);
  }
}
