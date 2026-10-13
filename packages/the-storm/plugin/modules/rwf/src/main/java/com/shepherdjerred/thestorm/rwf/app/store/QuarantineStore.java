package com.shepherdjerred.thestorm.rwf.app.store;

import java.time.Instant;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * Maps an operator took out of the rotation with {@code /rwf admin quarantine}, kept across
 * restarts until {@code /rwf admin unquarantine}. The maps {@code rwf.yml} quarantines are the
 * repository's record and are not kept here.
 */
public interface QuarantineStore {

  /** Every quarantined map, with the reason the operator gave. */
  CompletableFuture<Map<String, String>> all();

  /** Takes {@code mapId} out of the rotation, recording who did and why. */
  CompletableFuture<Void> quarantine(String mapId, String reason, String by, Instant at);

  /** Puts {@code mapId} back into the rotation. */
  CompletableFuture<Void> release(String mapId);
}
