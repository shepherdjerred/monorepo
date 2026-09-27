package com.shepherdjerred.thestorm.qol.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Random-teleport state. Futures complete off the main thread. */
public interface QolStore {

  /** The player's row, inserting {@code now} as first seen when they have none. */
  CompletableFuture<Ensured> ensure(UUID player, Instant now);

  /** Records a successful random teleport. */
  CompletableFuture<Void> setLastRtp(UUID player, Instant when);

  /** Saves an RTP entitlement before its keyed charge is attempted. */
  CompletableFuture<Void> insertRtpAttempt(RtpAttempt attempt);

  /** RTP entitlements that still need delivery or compensation. */
  CompletableFuture<List<RtpAttempt>> pendingRtpAttempts();

  /** Removes a delivered or compensated RTP entitlement. */
  CompletableFuture<Void> deleteRtpAttempt(UUID id);
}
