package com.shepherdjerred.thestorm.qol.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Random-teleport state. Futures complete off the main thread. */
public interface QolStore {

  /** The player's row, inserting {@code now} as first seen when they have none. */
  CompletableFuture<Ensured> ensure(UUID player, Instant now);

  /** Records the last wilderness search for its independent search throttle. */
  CompletableFuture<Void> setLastRtp(UUID player, Instant when);

  /**
   * Spends one compass trip after a successful landing. Returns the charges left. A miss, cancel,
   * or disconnect spends nothing.
   */
  CompletableFuture<Integer> spendStarterCharge(UUID player);

  /** Permanently discards the starter compass and all of its remaining trips. */
  CompletableFuture<Void> discardStarterCompass(UUID player);

  /** Legacy RTP entitlement storage retained for recovery; new charges use Essentials. */
  CompletableFuture<Void> insertRtpAttempt(RtpAttempt attempt);

  /** RTP entitlements that still need delivery or compensation. */
  CompletableFuture<List<RtpAttempt>> pendingRtpAttempts();

  /** Removes a delivered or compensated RTP entitlement. */
  CompletableFuture<Void> deleteRtpAttempt(UUID id);
}
