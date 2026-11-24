package com.shepherdjerred.thestorm.stats.app;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Supplier;

/** Asynchronous SQLite persistence port for player stats summaries, open sessions, and outbox. */
public interface StatsStore {

  record PendingEvent(UUID eventId, String eventJson) {}

  CompletableFuture<Void> save(StatsWrite write);

  CompletableFuture<Integer> recoverInterrupted(Instant recoveredAt, Supplier<UUID> eventIds);

  CompletableFuture<Optional<PlayerStatsSummary>> findPlayer(String nameOrUuid);

  CompletableFuture<Integer> countPlayers();

  CompletableFuture<List<PendingEvent>> pendingEvents(int limit);

  CompletableFuture<Void> acknowledgeEvents(List<UUID> eventIds);

  CompletableFuture<Void> resetPlayer(UUID playerUuid);
}
