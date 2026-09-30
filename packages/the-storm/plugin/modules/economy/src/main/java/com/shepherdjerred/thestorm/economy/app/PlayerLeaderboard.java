package com.shepherdjerred.thestorm.economy.app;

import java.util.List;
import java.util.concurrent.CompletableFuture;

/** Read-only player standings with names, for other modules that publish a leaderboard. */
@FunctionalInterface
public interface PlayerLeaderboard {

  /** The richest players with their last recorded names, highest first. */
  CompletableFuture<List<RankedPlayer>> leaderboard(int limit);
}
