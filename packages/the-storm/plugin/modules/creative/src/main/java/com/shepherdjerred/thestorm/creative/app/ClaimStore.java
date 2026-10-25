package com.shepherdjerred.thestorm.creative.app;

import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.StoredClaim;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/** Stored names, trust, and claims. The historical catalog is not this store. */
public interface ClaimStore {

  CompletableFuture<List<StoredClaim>> loadAll();

  /** Replaces the row and its trust list. */
  CompletableFuture<Void> save(StoredClaim claim);

  /** Replaces every row in one write. An empty list does nothing. */
  CompletableFuture<Void> saveAll(List<StoredClaim> claims);

  /** Deletes a player claim that was never in the catalog. */
  CompletableFuture<Void> delete(PlotId id);
}
