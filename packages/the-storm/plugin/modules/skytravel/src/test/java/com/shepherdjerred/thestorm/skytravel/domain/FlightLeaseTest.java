package com.shepherdjerred.thestorm.skytravel.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class FlightLeaseTest {
  private static final Instant START = Instant.parse("2026-11-07T12:00:00Z");
  private static final FlightLease LEASE =
      new FlightLease(
          UUID.fromString("00000000-0000-0000-0000-000000000001"),
          FlightLease.Phase.ASCENT,
          START.plusSeconds(120),
          START.plusSeconds(150),
          START.plusSeconds(15));

  @Test
  void assistanceExpiresAtItsOriginalDeadlineIncludingOfflineTime() {
    assertThat(LEASE.assisted(START.plusSeconds(119))).isTrue();
    assertThat(LEASE.assisted(START.plusSeconds(120))).isFalse();
    assertThat(LEASE.phase(FlightLease.Phase.GLIDE).assisted(START.plusSeconds(121))).isFalse();
  }

  @Test
  void finalDescentHasThirtySecondsAndEndsAtTheExactBoundary() {
    var descent = LEASE.phase(FlightLease.Phase.DESCENT);
    assertThat(descent.assisted(START.plusSeconds(121))).isFalse();
    assertThat(descent.protectedFromFall(START.plusSeconds(149))).isTrue();
    assertThat(descent.protectedFromFall(START.plusSeconds(150))).isFalse();
  }

  @Test
  void firstLandingRemovesBothPrivilegesButKeepsTheCooldown() {
    var landed = LEASE.phase(FlightLease.Phase.ENDED);
    assertThat(landed.assisted(START.plusSeconds(2))).isFalse();
    assertThat(landed.protectedFromFall(START.plusSeconds(2))).isFalse();
    assertThat(landed.cooldownUntil()).isEqualTo(START.plusSeconds(15));
  }
}
