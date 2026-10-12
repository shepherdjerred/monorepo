package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.KeyedTransfer;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.towns.domain.parcel.Lease;
import com.shepherdjerred.thestorm.towns.domain.parcel.LeasePayment;
import com.shepherdjerred.thestorm.towns.domain.parcel.ParcelKind;
import java.time.InstantSource;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.random.RandomGenerator;

/** Manual prepayment with a durable wallet intention; no recurring debits. Main thread only. */
public final class PlotRentals {
  private final ParcelBook book;
  private final LeaseStore store;
  private final Wallets wallets;
  private final Dependencies runtime;
  private final RentalGate gate;
  private final Map<UUID, UUID> busyPlayers = new HashMap<>();
  private final Set<UUID> settlingPayments = new HashSet<>();

  public record Dependencies(
      InstantSource time, RandomGenerator random, Executor mainThread, RentalGate gate) {}

  public PlotRentals(ParcelBook book, LeaseStore store, Wallets wallets, Dependencies runtime) {
    this.book = book;
    this.store = store;
    this.wallets = wallets;
    this.runtime = runtime;
    this.gate = runtime.gate();
  }

  public CompletableFuture<Result<Lease, String>> pay(UUID player, String id, boolean renew) {
    if (!renew) {
      return gate.enabled(player)
          .thenComposeAsync(
              enabled ->
                  enabled
                      ? payAuthorized(player, id, false)
                      : refused("New shop rentals are not open yet."),
              runtime.mainThread());
    }
    return payAuthorized(player, id, true);
  }

  private CompletableFuture<Result<Lease, String>> payAuthorized(
      UUID player, String id, boolean renew) {
    var reason = admission(player, id, renew);
    if (reason.isPresent()) {
      return refused(reason.orElseThrow());
    }
    if (busyPlayers.containsKey(player) || !book.begin(id)) {
      return refused("A plot operation is still settling. Try again shortly.");
    }
    var now = runtime.time().instant();
    var next =
        book.lease(id)
            .map(lease -> lease.renewed(now))
            .orElseGet(() -> new Lease(id, player, now.plus(Lease.WEEK), Lease.State.HELD));
    var payment =
        new LeasePayment(
            new UUID(runtime.random().nextLong(), runtime.random().nextLong()),
            id,
            player,
            next.paidThrough(),
            book.byId(id).orElseThrow().weeklyRent());
    busyPlayers.put(player, payment.operation());
    return store
        .prepare(payment)
        .thenComposeAsync(ignored -> settle(payment), runtime.mainThread())
        .whenCompleteAsync(
            (ignored, failure) -> releaseUnprepared(payment, failure), runtime.mainThread());
  }

  private java.util.Optional<String> admission(UUID player, String id, boolean renew) {
    var definition = book.byId(id);
    if (definition.isEmpty() || definition.get().kind() != ParcelKind.RENTAL_SHOP) {
      return java.util.Optional.of("That plot is not a rental.");
    }
    if (!renew && !book.prepared(id)) {
      return java.util.Optional.of("Staff have not prepared that plot's recovery baseline yet.");
    }
    var existing = book.lease(id);
    if (renew && (existing.isEmpty() || !existing.get().owner().equals(player))) {
      return java.util.Optional.of("You do not rent that plot.");
    }
    if (!renew && (existing.isPresent() || book.holdsRental(player))) {
      return java.util.Optional.of("The plot is occupied, or you already hold a rental.");
    }
    var now = runtime.time().instant();
    if (existing.isPresent() && existing.get().reclaimable(now)) {
      return java.util.Optional.of(
          "The seven-day grace period has ended. Your shop is being recovered.");
    }
    return java.util.Optional.empty();
  }

  private void releaseUnprepared(
      LeasePayment payment, @org.jspecify.annotations.Nullable Throwable failure) {
    if (failure == null) {
      return;
    }
    var _ =
        store
            .pending()
            .thenAcceptAsync(
                pending -> {
                  if (pending.stream()
                      .noneMatch(saved -> saved.operation().equals(payment.operation()))) {
                    release(payment);
                  }
                },
                runtime.mainThread());
  }

  /** Pending operations retain the same ledger key after a restart or an uncertain response. */
  public CompletableFuture<Void> recover(java.util.List<LeasePayment> pending) {
    CompletableFuture<Void> chain = CompletableFuture.completedFuture(null);
    for (var payment : pending) {
      var existing = busyPlayers.get(payment.owner());
      if (existing != null && !existing.equals(payment.operation())) {
        continue;
      }
      if (settlingPayments.contains(payment.operation())) {
        continue;
      }
      book.begin(payment.parcelId());
      busyPlayers.put(payment.owner(), payment.operation());
      chain =
          chain.thenComposeAsync(
              ignored -> settle(payment).thenAccept(result -> {}), runtime.mainThread());
    }
    return chain;
  }

  private CompletableFuture<Result<Lease, String>> settle(LeasePayment payment) {
    if (!settlingPayments.add(payment.operation())) {
      return refused("That payment is already settling.");
    }
    return wallets
        .transferOnce(
            new KeyedTransfer(
                payment.operation(),
                new AccountId.Player(payment.owner()),
                new AccountId.Server(),
                Crystals.of(payment.amount()),
                "plot:" + payment.parcelId() + ":week"))
        .thenComposeAsync(
            result -> {
              if (result.isOk()) {
                return store
                    .applied(payment)
                    .thenApplyAsync(
                        written -> {
                          if (written) {
                            book.committed(payment.lease());
                          }
                          release(payment);
                          return Result.<Lease, String>ok(payment.lease());
                        },
                        runtime.mainThread());
              }
              return store
                  .rejected(payment)
                  .thenApplyAsync(
                      ignored -> {
                        release(payment);
                        return Result.<Lease, String>err(
                            "Your wallet could not cover the weekly rent.");
                      },
                      runtime.mainThread());
            },
            runtime.mainThread())
        .whenCompleteAsync(
            (ignored, failure) -> settlingPayments.remove(payment.operation()),
            runtime.mainThread());
    // An uncertain payment/write keeps its plot frozen and its journal pending for recovery.
  }

  private void release(LeasePayment payment) {
    if (busyPlayers.remove(payment.owner(), payment.operation())) {
      book.end(payment.parcelId());
    }
  }

  public CompletableFuture<Void> reconcile() {
    return store.pending().thenComposeAsync(this::recover, runtime.mainThread());
  }

  private static CompletableFuture<Result<Lease, String>> refused(String reason) {
    return CompletableFuture.completedFuture(Result.err(reason));
  }
}
