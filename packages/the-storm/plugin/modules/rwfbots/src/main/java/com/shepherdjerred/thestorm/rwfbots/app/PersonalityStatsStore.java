package com.shepherdjerred.thestorm.rwfbots.app;

import java.util.Collection;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * Where personality records live between matches. Both calls run off the main thread; callers
 * complete the futures back onto it.
 */
public interface PersonalityStatsStore {

  /** Every record stored. */
  CompletableFuture<List<PersonalityStats>> loadAll();

  /** Writes {@code stats}, replacing earlier records of the same personalities. */
  CompletableFuture<Void> save(Collection<PersonalityStats> stats);
}
