package com.shepherdjerred.thestorm.qol.domain.grave;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class GraveAccessTest {

  private final UUID owner = UUID.randomUUID();
  private final Instant expires = Instant.parse("2026-09-01T00:10:00Z");

  @Test
  void theOwnerOpensBeforeItSpills() {
    var now = expires.minusSeconds(1);
    assertThat(GraveAccess.open(owner, owner, now, expires)).isEqualTo(GraveAccess.Open.OWNER);
  }

  @Test
  void someoneElseIsRefused() {
    var now = expires.minusSeconds(1);
    assertThat(GraveAccess.open(UUID.randomUUID(), owner, now, expires))
        .isEqualTo(GraveAccess.Open.DENIED);
  }

  @Test
  void anExpiredGraveHasSpilled() {
    assertThat(GraveAccess.open(owner, owner, expires, expires))
        .isEqualTo(GraveAccess.Open.EXPIRED);
  }
}
