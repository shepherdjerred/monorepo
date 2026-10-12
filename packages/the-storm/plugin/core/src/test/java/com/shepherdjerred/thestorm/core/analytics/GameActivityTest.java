package com.shepherdjerred.thestorm.core.analytics;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class GameActivityTest {
  @Test
  void recordsMembershipOnceAndTimesOnlyAdmittedPlayers() {
    var time = new SessionBookTest.Time();
    var writes = new ArrayList<AnalyticsWrite>();
    var book = new SessionBook(time, UUID::randomUUID, writes::add);
    var player = UUID.randomUUID();
    book.joined(player, "Player");
    var activity = new GameActivity(book, ProductAnalytics.Mode.SEARCH_AND_DESTROY);
    activity.left(player); // Refused/pending joins never become members.
    activity.joined(player);
    activity.joined(player); // Spectator becomes a fighter under the same membership.
    activity.started(List.of(player, UUID.randomUUID()));
    time.advance(10);
    activity.completed(List.of(player));
    activity.left(player);
    activity.left(player);
    time.advance(5);
    book.stop();
    var events = writes.stream().flatMap(write -> write.events().stream()).toList();
    assertThat(
            events.stream()
                .filter(event -> event.event().equals("storm_feature_interacted"))
                .map(event -> event.properties().get("action")))
        .containsExactly("joined", "match_started", "match_completed", "left");
    var intervals =
        events.stream().filter(event -> event.event().equals("storm_playtime_recorded")).toList();
    assertThat(intervals.getFirst().properties())
        .containsEntry("mode", "search_and_destroy")
        .containsEntry("connected_ms", 10000L);
    assertThat(intervals.getLast().properties())
        .containsEntry("mode", "survival")
        .containsEntry("connected_ms", 5000L);
  }
}
