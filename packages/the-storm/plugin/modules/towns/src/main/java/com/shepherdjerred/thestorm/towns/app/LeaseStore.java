package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.parcel.Lease;
import com.shepherdjerred.thestorm.towns.domain.parcel.LeasePayment;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/** Writer transactions for leases and their pending wallet operations. */
public interface LeaseStore {
  CompletableFuture<List<Lease>> load();

  CompletableFuture<List<LeasePayment>> pending();

  CompletableFuture<Void> prepare(LeasePayment payment);

  CompletableFuture<Boolean> applied(LeasePayment payment);

  CompletableFuture<Void> rejected(LeasePayment payment);
}
