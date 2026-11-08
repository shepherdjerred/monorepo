package com.shepherdjerred.thestorm.skytravel.app;

import com.shepherdjerred.thestorm.skytravel.domain.FlightLease;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Durable write-before-launch; all calls return without blocking Paper. */
public interface FlightStore {
  CompletableFuture<List<FlightLease>> load();

  CompletableFuture<Void> save(FlightLease lease);

  CompletableFuture<Void> reset(UUID player);
}
