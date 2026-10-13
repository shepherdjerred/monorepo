package com.shepherdjerred.thestorm.core.analytics;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Named game events: sent under their own name for a player in a session, values checked. */
final class GameEventTest {

  @Test
  void aGameEventGoesOutUnderItsNameWithTheSessionMode() {
    var time = new SessionBookTest.Time();
    var writes = new ArrayList<AnalyticsWrite>();
    var book = new SessionBook(time, UUID::randomUUID, writes::add);
    var player = UUID.randomUUID();
    book.joined(player, "Player");
    book.mode(player, ProductAnalytics.Mode.SEARCH_AND_DESTROY);
    time.advance(5);

    book.game(
        player, ProductAnalytics.GameEvent.RWF_MAP_VOTE, Map.of("map", "harbour", "candidates", 3));
    book.game(UUID.randomUUID(), ProductAnalytics.GameEvent.RWF_MAP_VOTE, Map.of("map", "x"));

    List<AnalyticsEvent> votes =
        writes.stream()
            .flatMap(write -> write.events().stream())
            .filter(event -> event.event().equals("rwf_map_vote"))
            .toList();
    assertThat(votes)
        .singleElement()
        .satisfies(
            vote ->
                assertThat(vote.properties())
                    .containsEntry("map", "harbour")
                    .containsEntry("candidates", 3)
                    .containsEntry("mode", "search_and_destroy"));
  }

  @Test
  void aPropertyThatIsNotAPlainValueIsRefused() {
    assertThatThrownBy(
            () ->
                ProductAnalytics.disabled()
                    .game(
                        UUID.randomUUID(),
                        ProductAnalytics.GameEvent.RWF_KIT_SELECTED,
                        Map.of("kit", List.of("trooper"))))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(ProductAnalytics.GameEvent.RWF_KILLSTREAK_USED.eventName())
        .isEqualTo("rwf_killstreak_used");
  }
}
