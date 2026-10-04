package com.shepherdjerred.thestorm.towns.adapter.db;

import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LEASES;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LEASE_PAYMENTS;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.towns.app.LeaseStore;
import com.shepherdjerred.thestorm.towns.domain.parcel.Lease;
import com.shepherdjerred.thestorm.towns.domain.parcel.LeasePayment;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** SQLite payment journal; applying the lease and marking the payment happen atomically. */
public final class JooqLeaseStore implements LeaseStore {
  private final StormDatabase database;

  public JooqLeaseStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<List<Lease>> load() {
    return database.read(
        dsl ->
            dsl.selectFrom(TOWNS_LEASES)
                .fetch()
                .map(
                    row ->
                        new Lease(
                            row.getParcelId(),
                            UUID.fromString(row.getOwnerId()),
                            Instant.ofEpochMilli(row.getPaidThrough()),
                            Lease.State.valueOf(row.getState()))));
  }

  @Override
  public CompletableFuture<List<LeasePayment>> pending() {
    return database.read(
        dsl ->
            dsl.selectFrom(TOWNS_LEASE_PAYMENTS)
                .where(TOWNS_LEASE_PAYMENTS.STATE.eq("PENDING"))
                .fetch()
                .map(
                    row ->
                        new LeasePayment(
                            UUID.fromString(row.getOperationId()),
                            row.getParcelId(),
                            UUID.fromString(row.getOwnerId()),
                            Instant.ofEpochMilli(row.getPaidThrough()),
                            row.getAmount())));
  }

  @Override
  public CompletableFuture<Void> prepare(LeasePayment payment) {
    return database
        .write(
            dsl -> {
              dsl.insertInto(TOWNS_LEASE_PAYMENTS)
                  .set(TOWNS_LEASE_PAYMENTS.OPERATION_ID, payment.operation().toString())
                  .set(TOWNS_LEASE_PAYMENTS.PARCEL_ID, payment.parcelId())
                  .set(TOWNS_LEASE_PAYMENTS.OWNER_ID, payment.owner().toString())
                  .set(TOWNS_LEASE_PAYMENTS.PAID_THROUGH, payment.paidThrough().toEpochMilli())
                  .set(TOWNS_LEASE_PAYMENTS.AMOUNT, payment.amount())
                  .set(TOWNS_LEASE_PAYMENTS.STATE, "PENDING")
                  .execute();
              return true;
            })
        .thenAccept(written -> {});
  }

  @Override
  public CompletableFuture<Boolean> applied(LeasePayment payment) {
    return database.write(
        dsl -> {
          var row =
              dsl.selectFrom(TOWNS_LEASE_PAYMENTS)
                  .where(TOWNS_LEASE_PAYMENTS.OPERATION_ID.eq(payment.operation().toString()))
                  .fetchOne();
          if (row == null || "REJECTED".equals(row.getState())) {
            throw new IllegalStateException(
                "missing or rejected lease payment " + payment.operation());
          }
          if (!row.getParcelId().equals(payment.parcelId())
              || !row.getOwnerId().equals(payment.owner().toString())
              || row.getPaidThrough() != payment.paidThrough().toEpochMilli()
              || row.getAmount() != payment.amount()) {
            throw new IllegalStateException("lease payment differs from its durable intention");
          }
          if ("APPLIED".equals(row.getState())) {
            return false;
          }
          dsl.insertInto(TOWNS_LEASES)
              .set(TOWNS_LEASES.PARCEL_ID, payment.parcelId())
              .set(TOWNS_LEASES.OWNER_ID, payment.owner().toString())
              .set(TOWNS_LEASES.PAID_THROUGH, payment.paidThrough().toEpochMilli())
              .set(TOWNS_LEASES.STATE, "HELD")
              .onConflict(TOWNS_LEASES.PARCEL_ID)
              .doUpdate()
              .set(TOWNS_LEASES.OWNER_ID, payment.owner().toString())
              .set(TOWNS_LEASES.PAID_THROUGH, payment.paidThrough().toEpochMilli())
              .set(TOWNS_LEASES.STATE, "HELD")
              .execute();
          dsl.update(TOWNS_LEASE_PAYMENTS)
              .set(TOWNS_LEASE_PAYMENTS.STATE, "APPLIED")
              .where(TOWNS_LEASE_PAYMENTS.OPERATION_ID.eq(payment.operation().toString()))
              .execute();
          return true;
        });
  }

  @Override
  public CompletableFuture<Void> rejected(LeasePayment payment) {
    return database
        .write(
            dsl -> {
              dsl.update(TOWNS_LEASE_PAYMENTS)
                  .set(TOWNS_LEASE_PAYMENTS.STATE, "REJECTED")
                  .where(TOWNS_LEASE_PAYMENTS.OPERATION_ID.eq(payment.operation().toString()))
                  .and(TOWNS_LEASE_PAYMENTS.STATE.eq("PENDING"))
                  .execute();
              return true;
            })
        .thenAccept(written -> {});
  }
}
