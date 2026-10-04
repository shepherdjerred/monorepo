package com.shepherdjerred.mcbridge.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.time.InstantSource;
import org.junit.jupiter.api.Test;

class EventRingTest {
  private static final Instant NOW = Instant.parse("2026-10-03T12:00:00Z");

  @Test
  void pagesEventsAfterTheCursor() {
    EventRing ring = new EventRing(10, InstantSource.fixed(NOW));
    ring.add(EventType.CHAT, "alice", "hi");
    ring.add(EventType.LOG, null, "line");
    ring.add(EventType.JOIN, "bob", "bob joined");

    EventRing.Page first = ring.since(0, 2);
    EventRing.Page second = ring.since(first.cursor(), 10);

    assertThat(first.events()).extracting(BridgeEvent::text).containsExactly("hi", "line");
    assertThat(first.cursor()).isEqualTo(2);
    assertThat(first.truncated()).isFalse();
    assertThat(second.events()).extracting(BridgeEvent::seq).containsExactly(3L);
    assertThat(second.events().getFirst().ts()).isEqualTo(NOW);
    assertThat(ring.since(3, 10).events()).isEmpty();
    assertThat(ring.since(3, 10).cursor()).isEqualTo(3);
  }

  @Test
  void reportsTruncationAfterEviction() {
    EventRing ring = new EventRing(2, InstantSource.fixed(NOW));
    ring.add(EventType.LOG, null, "1");
    ring.add(EventType.LOG, null, "2");
    ring.add(EventType.LOG, null, "3");

    EventRing.Page page = ring.since(0, 10);

    assertThat(page.truncated()).isTrue();
    assertThat(page.events()).extracting(BridgeEvent::text).containsExactly("2", "3");
    assertThat(ring.since(1, 10).truncated()).isFalse();
  }

  @Test
  void clampsAFutureCursorAndRejectsBadArguments() {
    EventRing ring = new EventRing(2, InstantSource.fixed(NOW));
    ring.add(EventType.LOG, null, "1");

    assertThat(ring.since(50, 10).cursor()).isEqualTo(1);
    assertThat(ring.since(50, 10).truncated()).isFalse();
    assertThatThrownBy(() -> ring.since(-1, 10)).isInstanceOf(BridgeException.class);
    assertThatThrownBy(() -> ring.since(0, 0)).isInstanceOf(BridgeException.class);
  }
}
