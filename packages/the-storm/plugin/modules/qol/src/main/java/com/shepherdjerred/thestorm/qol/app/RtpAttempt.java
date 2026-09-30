package com.shepherdjerred.thestorm.qol.app;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Durable entitlement to a teleport or a refund after charging for random teleport. */
public record RtpAttempt(UUID id, UUID player, long cost) {

  /** Distinct stable key for compensating this attempt's keyed charge. */
  public UUID refundKey() {
    return UUID.nameUUIDFromBytes(("rtp-refund:" + id).getBytes(StandardCharsets.UTF_8));
  }
}
