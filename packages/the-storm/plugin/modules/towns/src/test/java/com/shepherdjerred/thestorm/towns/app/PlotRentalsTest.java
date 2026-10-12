package com.shepherdjerred.thestorm.towns.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.towns.adapter.db.JooqLeaseStore;
import com.shepherdjerred.thestorm.towns.domain.parcel.Lease;
import com.shepherdjerred.thestorm.towns.domain.parcel.LeasePayment;
import com.shepherdjerred.thestorm.towns.domain.parcel.ParcelDefinition;
import com.shepherdjerred.thestorm.towns.domain.parcel.ParcelKind;
import com.shepherdjerred.thestorm.towns.domain.parcel.ParcelsConfig;
import com.shepherdjerred.thestorm.towns.domain.region.BlockCorner;
import com.shepherdjerred.thestorm.towns.domain.region.Cuboid;
import java.nio.file.Path;
import java.time.Instant;
import java.time.InstantSource;
import java.util.List;
import java.util.Random;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Real payment intentions and an idempotent ledger exercise uncertain debit recovery. */
final class PlotRentalsTest {
  @TempDir Path directory;
  private StormDatabase database;
  private JooqLeaseStore store;
  private ParcelBook book;
  private final FakeWallets wallets = new FakeWallets();
  private final UUID owner = UUID.randomUUID();
  private final Random random = new Random(42);
  private static final Instant NOW = Instant.parse("2026-10-03T00:00:00Z");

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("rental.db"));
    database.migrate("towns", getClass().getClassLoader());
    store = new JooqLeaseStore(database);
    book =
        new ParcelBook(
            new ParcelsConfig(
                List.of(definition("one", 0), definition("two", 20), definition("unprepared", 40))),
            InstantSource.fixed(NOW));
    book.baselineReady("one");
    book.baselineReady("two");
  }

  @AfterEach
  void close() {
    database.close();
  }

  @Test
  void noBaselineOrClosedAdmissionsCannotChargeButRenewalsStillWork() throws Exception {
    wallets.give(new AccountId.Player(owner), 10_000);
    var closed = rentals(store, false);
    assertThat(await(closed.pay(owner, "one", false)).isOk()).isFalse();
    assertThat(wallets.receipts()).isEmpty();
    var enabled = rentals(store, true);
    assertThat(await(enabled.pay(owner, "unprepared", false)).isOk()).isFalse();
    assertThat(wallets.receipts()).isEmpty();
    assertThat(await(store.pending())).isEmpty();
    assertThat(await(enabled.pay(owner, "one", false)).isOk()).isTrue();
    assertThat(await(closed.pay(owner, "one", true)).isOk()).isTrue();
    assertThat(book.lease("one").orElseThrow().paidThrough())
        .isEqualTo(NOW.plus(Lease.WEEK).plus(Lease.WEEK));
    assertThat(wallets.balanceOf(new AccountId.Player(owner))).isEqualTo(8560);
    assertThat(await(enabled.pay(owner, "two", false)).isOk()).isFalse();
  }

  @Test
  void insufficientFundsReleaseThePlotWithoutCreatingLease() throws Exception {
    assertThat(await(rentals(store, true).pay(owner, "one", false)).isOk()).isFalse();
    assertThat(await(store.pending())).isEmpty();
    assertThat(await(store.load())).isEmpty();
    assertThat(book.begin("one")).isTrue();
  }

  @Test
  void crashAfterDebitReusesLedgerKeyAndAppliesExactlyOneWeek() throws Exception {
    wallets.give(new AccountId.Player(owner), 1000);
    var interrupted = rentals(new InterruptedWrite(store), true);
    assertThatThrownBy(() -> await(interrupted.pay(owner, "one", false)))
        .hasRootCauseInstanceOf(IllegalStateException.class);
    assertThat(book.begin("one")).isFalse();
    assertThat(wallets.balanceOf(new AccountId.Player(owner))).isEqualTo(280);
    assertThat(await(store.pending())).hasSize(1);
    book.end("one");
    await(rentals(store, false).reconcile());
    assertThat(book.lease("one").orElseThrow().paidThrough()).isEqualTo(NOW.plus(Lease.WEEK));
    assertThat(wallets.receipts()).hasSize(1);
    assertThat(await(store.pending())).isEmpty();
  }

  @Test
  void simultaneousRequestsCannotAcquireTwoPlotsForOneOwner() throws Exception {
    wallets.give(new AccountId.Player(owner), 10_000);
    var rentals = rentals(store, true);
    var first = rentals.pay(owner, "one", false);
    var second = rentals.pay(owner, "two", false);
    assertThat(await(first).isOk()).isTrue();
    assertThat(await(second).isOk()).isFalse();
    assertThat(await(store.load())).hasSize(1);
    assertThat(wallets.receipts()).hasSize(1);
  }

  private PlotRentals rentals(LeaseStore source, boolean enabled) {
    return new PlotRentals(
        book,
        source,
        wallets,
        new PlotRentals.Dependencies(
            InstantSource.fixed(NOW),
            random,
            Runnable::run,
            player -> CompletableFuture.completedFuture(enabled)));
  }

  private static ParcelDefinition definition(String id, int x) {
    return new ParcelDefinition(
        id,
        id,
        ParcelKind.RENTAL_SHOP,
        new Cuboid("world", new BlockCorner(x, 69, 0), new BlockCorner(x + 11, 96, 11)),
        Set.of(),
        "Synthetic surveyed rental",
        720);
  }

  private record InterruptedWrite(LeaseStore store) implements LeaseStore {
    @Override
    public CompletableFuture<List<Lease>> load() {
      return store.load();
    }

    @Override
    public CompletableFuture<List<LeasePayment>> pending() {
      return store.pending();
    }

    @Override
    public CompletableFuture<Void> prepare(LeasePayment payment) {
      return store.prepare(payment);
    }

    @Override
    public CompletableFuture<Boolean> applied(LeasePayment payment) {
      return CompletableFuture.failedFuture(
          new IllegalStateException("simulated crash after ledger debit"));
    }

    @Override
    public CompletableFuture<Void> rejected(LeasePayment payment) {
      return store.rejected(payment);
    }
  }

  private static <T> T await(CompletableFuture<T> future) throws Exception {
    return future.get(10, TimeUnit.SECONDS);
  }
}
