package com.shepherdjerred.thestorm.quests.domain.engine;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class PartyActivityTest {

  @Test
  void onlyRecentlyActivePartnersShareCredit() {
    var player = new UUID(1, 2);
    var now = Instant.parse("2026-09-26T20:00:00Z");
    var window = Duration.ofSeconds(60);
    var activity = new PartyActivity();
    assertThat(activity.active(player, now, window)).isFalse();
    activity.acted(player, now);
    assertThat(activity.active(player, now.plusSeconds(60), window)).isTrue();
    assertThat(activity.active(player, now.plusSeconds(61), window)).isFalse();
    activity.acted(player, now.plusSeconds(61));
    assertThat(activity.active(player, now.plusSeconds(100), window)).isTrue();
    activity.forget(player);
    assertThat(activity.active(player, now.plusSeconds(100), window)).isFalse();
  }
}
