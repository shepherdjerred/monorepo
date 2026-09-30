package com.shepherdjerred.thestorm.world.app;

import com.shepherdjerred.thestorm.world.domain.DailyReport;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Durable, main-world-only event counts. Every write runs off the Paper thread. */
public interface DailyLedger {

  CompletableFuture<Void> recordArrival(LocalDate date, UUID player, Instant at);

  CompletableFuture<Void> recordDeath(LocalDate date, Instant at);

  CompletableFuture<Optional<DailyReport>> read(LocalDate date);
}
