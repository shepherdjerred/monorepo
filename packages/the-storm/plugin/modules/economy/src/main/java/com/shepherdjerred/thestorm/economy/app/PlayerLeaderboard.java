package com.shepherdjerred.thestorm.economy.app;

import java.util.List;
import java.util.concurrent.CompletableFuture;

/** Read-only player standings with names, for other modules that publish a leaderboard. */
@FunctionalInterface
public interface PlayerLeaderboard {

  /** The players holding the most {@code currency}, with their last recorded names. */
  CompletableFuture<List<RankedPlayer>> leaderboard(CurrencyId currency, int limit);
}
