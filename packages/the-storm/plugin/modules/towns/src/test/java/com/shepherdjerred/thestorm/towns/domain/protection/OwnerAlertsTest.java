package com.shepherdjerred.thestorm.towns.domain.protection;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.Test;

/** An owner hears about one visitor once a minute. */
final class OwnerAlertsTest {

  @Test
  void theSameVisitorIsQuietForAMinute() {
    var alerts = new OwnerAlerts(OwnerAlerts.COOLDOWN_MILLIS);
    var owner = UUID.randomUUID();
    var visitor = UUID.randomUUID();

    assertThat(alerts.shouldTell(owner, visitor, 0)).isTrue();
    assertThat(alerts.shouldTell(owner, visitor, 59_999)).isFalse();
    assertThat(alerts.shouldTell(owner, visitor, 60_000)).isTrue();
    assertThat(alerts.shouldTell(owner, UUID.randomUUID(), 1)).isTrue();
  }
}
