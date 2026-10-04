package com.shepherdjerred.thestorm.towns.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.towns.app.RecoveryStore;
import com.shepherdjerred.thestorm.towns.domain.parcel.Blob;
import com.shepherdjerred.thestorm.towns.domain.parcel.Lease;
import com.shepherdjerred.thestorm.towns.domain.parcel.LeasePayment;
import com.shepherdjerred.thestorm.towns.domain.parcel.PlotRecovery;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Real SQLite crash boundaries protect the lease, archived stock and single-use placement. */
final class JooqPlotStoreTest {
  @TempDir Path directory;
  private StormDatabase database;
  private JooqLeaseStore leases;
  private JooqRecoveryStore recoveries;
  private final UUID owner = UUID.randomUUID();
  private static final Blob ARCHIVE = new Blob(new byte[] {1, 2, 3});
  private static final PlotRecovery.Destination DESTINATION =
      new PlotRecovery.Destination("world", 300, 70, 300, 12, 28, 12);

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("plots.db"));
    database.migrate("towns", getClass().getClassLoader());
    leases = new JooqLeaseStore(database);
    recoveries = new JooqRecoveryStore(database);
  }

  @AfterEach
  void close() {
    database.close();
  }

  @Test
  void paymentsAreIdempotentAndAStaleRetryCannotUndoRenewal() throws Exception {
    var first = payment("market", Instant.EPOCH);
    await(leases.prepare(first));
    assertThat(await(leases.pending())).containsExactly(first);
    assertThat(await(leases.applied(first))).isTrue();
    var renewed = payment("market", Instant.EPOCH.plus(Lease.WEEK));
    await(leases.prepare(renewed));
    assertThat(await(leases.applied(renewed))).isTrue();
    assertThat(await(leases.applied(first))).isFalse();
    assertThat(await(leases.load())).containsExactly(renewed.lease());
    assertThat(await(leases.pending())).isEmpty();
  }

  @Test
  void onePendingPlotPerOwnerAndOneLeasePerOwner() throws Exception {
    var first = payment("market", Instant.EPOCH);
    await(leases.prepare(first));
    assertThatThrownBy(() -> await(leases.prepare(payment("other", Instant.EPOCH))))
        .hasRootCauseInstanceOf(java.sql.SQLException.class);
    await(leases.applied(first));
    var second = payment("other", Instant.EPOCH);
    await(leases.prepare(second));
    assertThatThrownBy(() -> await(leases.applied(second)))
        .hasRootCauseInstanceOf(java.sql.SQLException.class);
    assertThat(await(leases.load())).containsExactly(first.lease());
    await(leases.rejected(second));
    assertThat(await(leases.pending())).isEmpty();
  }

  @Test
  void snapshotKeepsLeaseUntilResetAndMailAreCheckpointed() throws Exception {
    var saved = snapshot();
    assertThat(await(leases.load()).getFirst().state()).isEqualTo(Lease.State.RESETTING);
    assertThat(await(recoveries.unfinished())).containsExactly(saved);
    database.close();
    open();
    assertThat(await(recoveries.byId(saved.id()))).contains(saved);
    await(recoveries.resetComplete(saved.id()));
    assertThat(await(leases.load())).isEmpty();
    assertThat(await(recoveries.unfinished()).getFirst().state())
        .isEqualTo(PlotRecovery.State.AVAILABLE);
    await(recoveries.mailed(saved.id()));
    assertThat(await(recoveries.unfinished())).isEmpty();
  }

  @Test
  void placementCannotUseForeignOrStaleTokensAndSurvivesRestart() throws Exception {
    var saved = available();
    assertThatThrownBy(
            () ->
                await(
                    recoveries.placing(
                        new RecoveryStore.Placement(
                            saved.id(), UUID.randomUUID(), saved.token(), DESTINATION, ARCHIVE))))
        .hasRootCauseInstanceOf(IllegalStateException.class);
    var replacement = UUID.randomUUID();
    await(recoveries.reissue(saved.id(), owner, saved.token(), replacement));
    assertThatThrownBy(
            () ->
                await(
                    recoveries.placing(
                        new RecoveryStore.Placement(
                            saved.id(), owner, saved.token(), DESTINATION, ARCHIVE))))
        .hasRootCauseInstanceOf(IllegalStateException.class);
    var placement =
        new RecoveryStore.Placement(saved.id(), owner, replacement, DESTINATION, ARCHIVE);
    await(recoveries.placing(placement));
    assertThatThrownBy(() -> await(recoveries.placing(placement)))
        .hasRootCauseInstanceOf(IllegalStateException.class);
    database.close();
    open();
    assertThat(await(recoveries.before(saved.id()))).isEqualTo(ARCHIVE);
    assertThat(await(recoveries.unfinished()).getFirst().destination()).contains(DESTINATION);
    await(recoveries.placed(saved.id()));
    assertThat(await(recoveries.unfinished())).isEmpty();
    assertThatThrownBy(() -> await(recoveries.rollingBack(saved.id())))
        .hasRootCauseInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void rollbackJournalRetainsPreimageUntilVerifiedAndReturnsSameToken() throws Exception {
    var saved = available();
    await(
        recoveries.placing(
            new RecoveryStore.Placement(saved.id(), owner, saved.token(), DESTINATION, ARCHIVE)));
    await(recoveries.rollingBack(saved.id()));
    await(recoveries.rollingBack(saved.id()));
    database.close();
    open();
    assertThat(await(recoveries.unfinished()).getFirst().state())
        .isEqualTo(PlotRecovery.State.ROLLING_BACK);
    assertThat(await(recoveries.before(saved.id()))).isEqualTo(ARCHIVE);
    await(recoveries.rolledBack(saved.id()));
    var returned = await(recoveries.byId(saved.id())).orElseThrow();
    assertThat(returned.state()).isEqualTo(PlotRecovery.State.AVAILABLE);
    assertThat(returned.token()).isEqualTo(saved.token());
    assertThat(returned.destination()).isEmpty();
    await(
        recoveries.placing(
            new RecoveryStore.Placement(saved.id(), owner, saved.token(), DESTINATION, ARCHIVE)));
  }

  private LeasePayment payment(String id, Instant expiry) {
    return new LeasePayment(UUID.randomUUID(), id, owner, expiry, 720);
  }

  private PlotRecovery snapshot() throws Exception {
    var payment = payment("market", Instant.EPOCH);
    await(leases.prepare(payment));
    await(leases.applied(payment));
    var saved =
        new PlotRecovery(
            UUID.randomUUID(),
            "market",
            owner,
            ARCHIVE,
            ARCHIVE,
            ARCHIVE,
            PlotRecovery.State.SNAPSHOT,
            UUID.randomUUID(),
            Optional.empty());
    await(recoveries.snapshot(saved));
    return saved;
  }

  private PlotRecovery available() throws Exception {
    var saved = snapshot();
    await(recoveries.resetComplete(saved.id()));
    await(recoveries.mailed(saved.id()));
    return saved.withState(PlotRecovery.State.AVAILABLE);
  }

  private static <T> T await(CompletableFuture<T> future) throws Exception {
    return future.get(10, TimeUnit.SECONDS);
  }
}
