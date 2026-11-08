package com.shepherdjerred.thestorm.skytravel.adapter.db;

import static com.shepherdjerred.thestorm.skytravel.adapter.db.generated.Tables.SKYTRAVEL_FLIGHTS;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.skytravel.app.FlightStore;
import com.shepherdjerred.thestorm.skytravel.domain.FlightLease;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Shared SQLite writer provides ordering between launches, transitions and resets. */
public final class JooqFlightStore implements FlightStore {
  private final StormDatabase database;

  public JooqFlightStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<List<FlightLease>> load() {
    return database.read(
        dsl ->
            dsl.selectFrom(SKYTRAVEL_FLIGHTS)
                .fetch(
                    row ->
                        new FlightLease(
                            UUID.fromString(row.getPlayer()),
                            FlightLease.Phase.valueOf(row.getPhase()),
                            Instant.ofEpochMilli(row.getAssistedUntil()),
                            Instant.ofEpochMilli(row.getProtectedUntil()),
                            Instant.ofEpochMilli(row.getCooldownUntil()))));
  }

  @Override
  public CompletableFuture<Void> save(FlightLease lease) {
    return database.write(
        dsl -> {
          dsl.insertInto(SKYTRAVEL_FLIGHTS)
              .set(SKYTRAVEL_FLIGHTS.PLAYER, lease.player().toString())
              .set(SKYTRAVEL_FLIGHTS.PHASE, lease.phase().name())
              .set(SKYTRAVEL_FLIGHTS.ASSISTED_UNTIL, lease.assistedUntil().toEpochMilli())
              .set(SKYTRAVEL_FLIGHTS.PROTECTED_UNTIL, lease.protectedUntil().toEpochMilli())
              .set(SKYTRAVEL_FLIGHTS.COOLDOWN_UNTIL, lease.cooldownUntil().toEpochMilli())
              .onConflict(SKYTRAVEL_FLIGHTS.PLAYER)
              .doUpdate()
              .set(SKYTRAVEL_FLIGHTS.PHASE, lease.phase().name())
              .set(SKYTRAVEL_FLIGHTS.ASSISTED_UNTIL, lease.assistedUntil().toEpochMilli())
              .set(SKYTRAVEL_FLIGHTS.PROTECTED_UNTIL, lease.protectedUntil().toEpochMilli())
              .set(SKYTRAVEL_FLIGHTS.COOLDOWN_UNTIL, lease.cooldownUntil().toEpochMilli())
              .execute();
          return (Void) null;
        });
  }

  @Override
  public CompletableFuture<Void> reset(UUID player) {
    return database.write(
        dsl -> {
          dsl.deleteFrom(SKYTRAVEL_FLIGHTS)
              .where(SKYTRAVEL_FLIGHTS.PLAYER.eq(player.toString()))
              .execute();
          return (Void) null;
        });
  }
}
