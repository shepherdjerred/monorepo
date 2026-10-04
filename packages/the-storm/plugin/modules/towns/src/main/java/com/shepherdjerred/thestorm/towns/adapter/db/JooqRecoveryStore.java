package com.shepherdjerred.thestorm.towns.adapter.db;

import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LEASES;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_PLOT_BASELINES;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_PLOT_RECOVERIES;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.towns.adapter.db.generated.tables.records.TownsPlotRecoveriesRecord;
import com.shepherdjerred.thestorm.towns.app.RecoveryStore;
import com.shepherdjerred.thestorm.towns.domain.parcel.Blob;
import com.shepherdjerred.thestorm.towns.domain.parcel.PlotRecovery;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import tools.jackson.databind.json.JsonMapper;

/** Snapshots, plot release and placement checkpoints share the database writer. */
public final class JooqRecoveryStore implements RecoveryStore {
  private static final JsonMapper JSON = JsonMapper.builder().build();
  private final StormDatabase database;

  public JooqRecoveryStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<List<Baseline>> baselines() {
    return database.read(
        dsl ->
            dsl.selectFrom(TOWNS_PLOT_BASELINES)
                .fetch()
                .map(
                    row ->
                        new Baseline(
                            row.getParcelId(),
                            row.getDefinitionHash(),
                            new Blob(row.getSchematic()))));
  }

  @Override
  public CompletableFuture<Void> baseline(Baseline baseline) {
    return database
        .write(
            dsl -> {
              if (dsl.fetchExists(
                  TOWNS_PLOT_BASELINES, TOWNS_PLOT_BASELINES.PARCEL_ID.eq(baseline.parcelId()))) {
                throw new IllegalStateException(
                    "baseline already exists for " + baseline.parcelId());
              }
              dsl.insertInto(TOWNS_PLOT_BASELINES)
                  .set(TOWNS_PLOT_BASELINES.PARCEL_ID, baseline.parcelId())
                  .set(TOWNS_PLOT_BASELINES.DEFINITION_HASH, baseline.definitionHash())
                  .set(TOWNS_PLOT_BASELINES.SCHEMATIC, baseline.schematic().bytes())
                  .execute();
              return true;
            })
        .thenAccept(written -> {});
  }

  @Override
  public CompletableFuture<List<PlotRecovery>> unfinished() {
    return database.read(
        dsl ->
            dsl.selectFrom(TOWNS_PLOT_RECOVERIES)
                .where(
                    TOWNS_PLOT_RECOVERIES
                        .STATE
                        .in("SNAPSHOT", "PLACING", "ROLLING_BACK")
                        .or(
                            TOWNS_PLOT_RECOVERIES
                                .STATE
                                .eq("AVAILABLE")
                                .and(TOWNS_PLOT_RECOVERIES.MAILED.eq(0))))
                .fetch()
                .map(JooqRecoveryStore::recovery));
  }

  @Override
  public CompletableFuture<Optional<PlotRecovery>> byId(UUID id) {
    return database.read(
        dsl ->
            Optional.ofNullable(
                    dsl.selectFrom(TOWNS_PLOT_RECOVERIES)
                        .where(TOWNS_PLOT_RECOVERIES.RECOVERY_ID.eq(id.toString()))
                        .fetchOne())
                .map(JooqRecoveryStore::recovery));
  }

  @Override
  public CompletableFuture<Void> snapshot(PlotRecovery recovery) {
    return database
        .write(
            dsl -> {
              var lease =
                  dsl.selectFrom(TOWNS_LEASES)
                      .where(TOWNS_LEASES.PARCEL_ID.eq(recovery.parcelId()))
                      .fetchOne();
              if (lease == null
                  || !lease.getOwnerId().equals(recovery.owner().toString())
                  || !"HELD".equals(lease.getState())) {
                throw new IllegalStateException("lease changed before its snapshot committed");
              }
              dsl.insertInto(TOWNS_PLOT_RECOVERIES)
                  .set(TOWNS_PLOT_RECOVERIES.RECOVERY_ID, recovery.id().toString())
                  .set(TOWNS_PLOT_RECOVERIES.PARCEL_ID, recovery.parcelId())
                  .set(TOWNS_PLOT_RECOVERIES.OWNER_ID, recovery.owner().toString())
                  .set(TOWNS_PLOT_RECOVERIES.SCHEMATIC, recovery.schematic().bytes())
                  .set(TOWNS_PLOT_RECOVERIES.MATERIALS, recovery.materials().bytes())
                  .set(TOWNS_PLOT_RECOVERIES.AUXILIARY, recovery.auxiliary().bytes())
                  .set(TOWNS_PLOT_RECOVERIES.STATE, "SNAPSHOT")
                  .set(TOWNS_PLOT_RECOVERIES.TOKEN_ID, recovery.token().toString())
                  .set(TOWNS_PLOT_RECOVERIES.MAILED, 0)
                  .execute();
              dsl.update(TOWNS_LEASES)
                  .set(TOWNS_LEASES.STATE, "RESETTING")
                  .where(TOWNS_LEASES.PARCEL_ID.eq(recovery.parcelId()))
                  .execute();
              return true;
            })
        .thenAccept(written -> {});
  }

  @Override
  public CompletableFuture<Void> resetComplete(UUID id) {
    return database
        .write(
            dsl -> {
              var recovery =
                  dsl.selectFrom(TOWNS_PLOT_RECOVERIES)
                      .where(TOWNS_PLOT_RECOVERIES.RECOVERY_ID.eq(id.toString()))
                      .fetchOne();
              if (recovery == null || !"SNAPSHOT".equals(recovery.getState())) {
                throw new IllegalStateException("reset checkpoint has no pending snapshot");
              }
              var count =
                  dsl.deleteFrom(TOWNS_LEASES)
                      .where(TOWNS_LEASES.PARCEL_ID.eq(recovery.getParcelId()))
                      .and(TOWNS_LEASES.OWNER_ID.eq(recovery.getOwnerId()))
                      .and(TOWNS_LEASES.STATE.eq("RESETTING"))
                      .execute();
              if (count != 1) {
                throw new IllegalStateException("reset checkpoint lost its lease");
              }
              dsl.update(TOWNS_PLOT_RECOVERIES)
                  .set(TOWNS_PLOT_RECOVERIES.STATE, "AVAILABLE")
                  .where(TOWNS_PLOT_RECOVERIES.RECOVERY_ID.eq(id.toString()))
                  .execute();
              return true;
            })
        .thenAccept(written -> {});
  }

  @Override
  public CompletableFuture<Void> mailed(UUID id) {
    return database
        .write(
            dsl ->
                dsl.update(TOWNS_PLOT_RECOVERIES)
                    .set(TOWNS_PLOT_RECOVERIES.MAILED, 1)
                    .where(TOWNS_PLOT_RECOVERIES.RECOVERY_ID.eq(id.toString()))
                    .and(TOWNS_PLOT_RECOVERIES.STATE.eq("AVAILABLE"))
                    .execute())
        .thenAccept(written -> {});
  }

  @Override
  public CompletableFuture<Void> placing(Placement placement) {
    var id = placement.id();
    var owner = placement.owner();
    var token = placement.token();
    var destination = placement.destination();
    var before = placement.before();
    return database
        .write(
            dsl -> {
              var changed =
                  dsl.update(TOWNS_PLOT_RECOVERIES)
                      .set(TOWNS_PLOT_RECOVERIES.STATE, "PLACING")
                      .set(TOWNS_PLOT_RECOVERIES.DESTINATION, JSON.writeValueAsString(destination))
                      .set(TOWNS_PLOT_RECOVERIES.BEFORE_SCHEMATIC, before.bytes())
                      .where(TOWNS_PLOT_RECOVERIES.RECOVERY_ID.eq(id.toString()))
                      .and(TOWNS_PLOT_RECOVERIES.OWNER_ID.eq(owner.toString()))
                      .and(TOWNS_PLOT_RECOVERIES.TOKEN_ID.eq(token.toString()))
                      .and(TOWNS_PLOT_RECOVERIES.STATE.eq("AVAILABLE"))
                      .and(TOWNS_PLOT_RECOVERIES.MAILED.eq(1))
                      .execute();
              if (changed != 1) {
                throw new IllegalStateException("packed shop is stale or already consumed");
              }
              return true;
            })
        .thenAccept(written -> {});
  }

  @Override
  public CompletableFuture<Void> placed(UUID id) {
    return database
        .write(
            dsl -> {
              var changed =
                  dsl.update(TOWNS_PLOT_RECOVERIES)
                      .set(TOWNS_PLOT_RECOVERIES.STATE, "PLACED")
                      .where(TOWNS_PLOT_RECOVERIES.RECOVERY_ID.eq(id.toString()))
                      .and(TOWNS_PLOT_RECOVERIES.STATE.eq("PLACING"))
                      .execute();
              if (changed != 1) {
                throw new IllegalStateException("placement checkpoint has no pending journal");
              }
              return true;
            })
        .thenAccept(written -> {});
  }

  private static PlotRecovery recovery(TownsPlotRecoveriesRecord row) {
    var destination = row.getDestination();
    return new PlotRecovery(
        UUID.fromString(row.getRecoveryId()),
        row.getParcelId(),
        UUID.fromString(row.getOwnerId()),
        new Blob(row.getSchematic()),
        new Blob(row.getMaterials()),
        new Blob(row.getAuxiliary()),
        PlotRecovery.State.valueOf(row.getState()),
        UUID.fromString(row.getTokenId()),
        destination == null
            ? Optional.empty()
            : Optional.of(
                StrictYaml.parseJson(
                        "recovery destination", destination, PlotRecovery.Destination.class)
                    .fold(
                        value -> value,
                        problems -> {
                          throw new IllegalStateException(problems.toString());
                        })));
  }

  @Override
  public CompletableFuture<Blob> before(UUID id) {
    return database.read(
        dsl -> {
          var bytes =
              dsl.select(TOWNS_PLOT_RECOVERIES.BEFORE_SCHEMATIC)
                  .from(TOWNS_PLOT_RECOVERIES)
                  .where(TOWNS_PLOT_RECOVERIES.RECOVERY_ID.eq(id.toString()))
                  .and(TOWNS_PLOT_RECOVERIES.STATE.in("PLACING", "ROLLING_BACK"))
                  .fetchOne(TOWNS_PLOT_RECOVERIES.BEFORE_SCHEMATIC);
          if (bytes == null) {
            throw new IllegalStateException("placement has no preimage checkpoint");
          }
          return new Blob(bytes);
        });
  }

  @Override
  public CompletableFuture<Void> rollingBack(UUID id) {
    return database
        .write(
            dsl -> {
              var changed =
                  dsl.update(TOWNS_PLOT_RECOVERIES)
                      .set(TOWNS_PLOT_RECOVERIES.STATE, "ROLLING_BACK")
                      .where(TOWNS_PLOT_RECOVERIES.RECOVERY_ID.eq(id.toString()))
                      .and(TOWNS_PLOT_RECOVERIES.STATE.in("PLACING", "ROLLING_BACK"))
                      .execute();
              if (changed != 1) {
                throw new IllegalArgumentException(
                    "only an unfinished placement may be rolled back");
              }
              return true;
            })
        .thenAccept(written -> {});
  }

  @Override
  public CompletableFuture<Void> rolledBack(UUID id) {
    return database
        .write(
            dsl -> {
              var changed =
                  dsl.update(TOWNS_PLOT_RECOVERIES)
                      .set(TOWNS_PLOT_RECOVERIES.STATE, "AVAILABLE")
                      .setNull(TOWNS_PLOT_RECOVERIES.DESTINATION)
                      .setNull(TOWNS_PLOT_RECOVERIES.BEFORE_SCHEMATIC)
                      .where(TOWNS_PLOT_RECOVERIES.RECOVERY_ID.eq(id.toString()))
                      .and(TOWNS_PLOT_RECOVERIES.STATE.eq("ROLLING_BACK"))
                      .execute();
              if (changed != 1) {
                throw new IllegalStateException("rollback checkpoint has no pending journal");
              }
              return true;
            })
        .thenAccept(written -> {});
  }

  @Override
  public CompletableFuture<Void> reissue(UUID id, UUID owner, UUID previousToken, UUID token) {
    return database
        .write(
            dsl -> {
              var changed =
                  dsl.update(TOWNS_PLOT_RECOVERIES)
                      .set(TOWNS_PLOT_RECOVERIES.TOKEN_ID, token.toString())
                      .where(TOWNS_PLOT_RECOVERIES.RECOVERY_ID.eq(id.toString()))
                      .and(TOWNS_PLOT_RECOVERIES.OWNER_ID.eq(owner.toString()))
                      .and(TOWNS_PLOT_RECOVERIES.TOKEN_ID.eq(previousToken.toString()))
                      .and(TOWNS_PLOT_RECOVERIES.STATE.eq("AVAILABLE"))
                      .and(TOWNS_PLOT_RECOVERIES.MAILED.eq(1))
                      .execute();
              if (changed != 1) {
                throw new IllegalStateException("packed shop changed before replacement");
              }
              return true;
            })
        .thenAccept(written -> {});
  }
}
