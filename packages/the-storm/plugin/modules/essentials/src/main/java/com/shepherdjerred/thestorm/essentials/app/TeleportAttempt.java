package com.shepherdjerred.thestorm.essentials.app;

import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** A paid teleport whose ledger charge or refund may need reconciliation. */
public record TeleportAttempt(UUID id, UUID payer, TeleportKind kind, long cost) {

  public TeleportAttempt {
    if (cost <= 0) {
      throw new IllegalArgumentException("a persisted teleport attempt must have a cost");
    }
  }

  /** A stable, distinct ledger key for the compensating refund. */
  public UUID refundKey() {
    return UUID.nameUUIDFromBytes(("teleport-refund:" + id).getBytes(StandardCharsets.UTF_8));
  }
}
