package com.shepherdjerred.thestorm.qol.domain.grave;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.qol.domain.grave.GravePolicy.Access;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePolicy.Opener;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePolicy.Status;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

final class GravePolicyTest {

  static final Instant DIED = Instant.parse("2026-09-25T12:00:00Z");
  static final Duration LOCK = Duration.ofMinutes(15);
  static final Duration EXPIRY = Duration.ofDays(3);
  static final GravePolicy POLICY = new GravePolicy(LOCK, EXPIRY);
  static final Grave GRAVE =
      new Grave(
          UUID.fromString("00000000-0000-0000-0000-00000000000a"),
          UUID.fromString("00000000-0000-0000-0000-0000000000a1"),
          "Alice",
          new GravePos("world", 1, 64, 2),
          DIED);
  static final Duration NANO = Duration.ofNanos(1);

  static Instant after(Duration duration) {
    return DIED.plus(duration);
  }

  @Test
  void theOwnerCanAlwaysTakeEverything() {
    for (var at : new Duration[] {Duration.ZERO, LOCK, EXPIRY, EXPIRY.plusDays(30)}) {
      assertThat(POLICY.access(GRAVE, Opener.OWNER, after(at))).isEqualTo(new Access.Everything());
    }
  }

  @Test
  void othersAreLockedOutUntilTheLockEndsToTheNanosecond() {
    assertThat(POLICY.access(GRAVE, Opener.OTHER, DIED)).isEqualTo(new Access.Locked(LOCK));
    assertThat(POLICY.access(GRAVE, Opener.OTHER, after(LOCK.minus(NANO))))
        .isEqualTo(new Access.Locked(NANO));
    assertThat(POLICY.access(GRAVE, Opener.OTHER, after(LOCK))).isEqualTo(new Access.WhatFits());
    assertThat(POLICY.access(GRAVE, Opener.OTHER, after(EXPIRY.plusHours(1))))
        .isEqualTo(new Access.WhatFits());
  }

  @Test
  void staffMayTakeWhatFitsEvenWhileLocked() {
    assertThat(POLICY.access(GRAVE, Opener.STAFF, DIED)).isEqualTo(new Access.WhatFits());
  }

  @Test
  void aClockBeforeTheDeathStillCountsAsLocked() {
    assertThat(POLICY.access(GRAVE, Opener.OTHER, DIED.minusSeconds(5)))
        .isEqualTo(new Access.Locked(LOCK.plusSeconds(5)));
  }

  @Test
  void statusMovesFromLockedToOpenToExpiredAtExactBoundaries() {
    assertThat(POLICY.status(GRAVE, DIED)).isEqualTo(new Status.Locked(LOCK));
    assertThat(POLICY.status(GRAVE, after(LOCK.minus(NANO)))).isEqualTo(new Status.Locked(NANO));
    assertThat(POLICY.status(GRAVE, after(LOCK))).isEqualTo(new Status.Open(EXPIRY.minus(LOCK)));
    assertThat(POLICY.status(GRAVE, after(EXPIRY.minus(NANO)))).isEqualTo(new Status.Open(NANO));
    assertThat(POLICY.status(GRAVE, after(EXPIRY))).isEqualTo(new Status.Expired());
    assertThat(POLICY.isExpired(GRAVE, after(EXPIRY.minus(NANO)))).isFalse();
    assertThat(POLICY.isExpired(GRAVE, after(EXPIRY))).isTrue();
    assertThat(POLICY.unlocksAt(GRAVE)).isEqualTo(after(LOCK));
    assertThat(POLICY.expiresAt(GRAVE)).isEqualTo(after(EXPIRY));
  }

  @ParameterizedTest
  @EnumSource(Opener.class)
  void withNoLockAGraveIsOpenAtOnce(Opener opener) {
    var open = new GravePolicy(Duration.ZERO, EXPIRY);
    assertThat(open.access(GRAVE, opener, DIED)).isNotInstanceOf(Access.Locked.class);
    assertThat(open.status(GRAVE, DIED)).isEqualTo(new Status.Open(EXPIRY));
  }

  @Test
  void theExpiryMustComeAfterTheLock() {
    assertThatThrownBy(() -> new GravePolicy(Duration.ofMinutes(-1), EXPIRY))
        .hasMessageContaining("negative");
    assertThatThrownBy(() -> new GravePolicy(LOCK, LOCK)).hasMessageContaining("longer");
    assertThatThrownBy(() -> new GravePolicy(LOCK, Duration.ofMinutes(5)))
        .hasMessageContaining("longer");
  }
}
