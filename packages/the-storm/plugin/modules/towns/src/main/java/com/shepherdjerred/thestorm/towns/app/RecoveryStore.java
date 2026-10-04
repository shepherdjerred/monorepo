package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.parcel.Blob;
import com.shepherdjerred.thestorm.towns.domain.parcel.PlotRecovery;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Durable snapshots precede the first world write; a plot reopens only after reset verification.
 */
public interface RecoveryStore {
  record Baseline(String parcelId, String definitionHash, Blob schematic) {}

  CompletableFuture<List<Baseline>> baselines();

  CompletableFuture<Void> baseline(Baseline baseline);

  CompletableFuture<List<PlotRecovery>> unfinished();

  CompletableFuture<Optional<PlotRecovery>> byId(UUID id);

  CompletableFuture<Void> snapshot(PlotRecovery recovery);

  CompletableFuture<Void> resetComplete(UUID id);

  CompletableFuture<Void> mailed(UUID id);

  record Placement(
      UUID id, UUID owner, UUID token, PlotRecovery.Destination destination, Blob before) {}

  CompletableFuture<Void> placing(Placement placement);

  CompletableFuture<Void> placed(UUID id);

  CompletableFuture<Void> reissue(UUID id, UUID owner, UUID previousToken, UUID token);

  CompletableFuture<Blob> before(UUID id);

  CompletableFuture<Void> rollingBack(UUID id);

  CompletableFuture<Void> rolledBack(UUID id);
}
