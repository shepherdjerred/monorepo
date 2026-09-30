package com.shepherdjerred.thestorm.arena.app;

import java.util.OptionalInt;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Players' arena records, for quests and other modules ("reach wave 30"). Obtain it with {@code
 * context.services().require(ArenaRecords.class)}. Futures complete off the main thread; complete
 * them back onto it with {@code Scheduler.mainThread()}.
 */
public interface ArenaRecords {

  /** The furthest wave {@code player} has reached in {@code arena}, if they have played it. */
  CompletableFuture<OptionalInt> bestWave(UUID player, String arena);
}
