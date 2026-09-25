package com.shepherdjerred.thestorm.tracks.app;

import static java.util.concurrent.CompletableFuture.completedFuture;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import com.shepherdjerred.thestorm.tracks.domain.purchase.PurchaseAttempt;
import com.shepherdjerred.thestorm.tracks.domain.purchase.PurchaseRules;
import com.shepherdjerred.thestorm.tracks.domain.purchase.TrackStanding;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Buying track levels. The level is written only after the economy has taken payment; if it then
 * cannot be written, the payment is refunded with a compensating transfer, so a player is never
 * charged for a level they do not get. One purchase per player runs at a time.
 */
public final class PurchaseService implements TrackPurchases {

  private static final AccountId SERVER = new AccountId.Server();

  private final TrackRuntime runtime;
  private final Wallets wallets;
  private final PurchaseRules rules;
  private final Set<UUID> buying = ConcurrentHashMap.newKeySet();

  public PurchaseService(TrackRuntime runtime, Wallets wallets, PurchaseRules rules) {
    this.runtime = runtime;
    this.wallets = wallets;
    this.rules = rules;
  }

  /** The ledger reason for buying {@code quote}, for example {@code track:mechanic:2}. */
  public static String reason(Quote quote) {
    return "track:" + quote.track().id() + ":" + quote.level();
  }

  /** The ledger reason for refunding {@code quote}. */
  public static String refundReason(Quote quote) {
    return "track-refund:" + quote.track().id() + ":" + quote.level();
  }

  /**
   * Every track's standing for {@code player}, for {@code /perks}; empty until they have loaded.
   */
  public CompletableFuture<Result<List<TrackStanding>, PurchaseProblem>> overview(UUID player) {
    var loaded = runtime.cache().progress(player);
    if (loaded.isEmpty()) {
      return completedFuture(Result.err(new PurchaseProblem.StillLoading()));
    }
    var progress = loaded.get();
    return wallets
        .balance(account(player))
        .thenApplyAsync(
            balance ->
                Result.ok(rules.overview(progress, runtime.time().instant(), balance.amount())),
            runtime.mainThread());
  }

  @Override
  public CompletableFuture<Result<Quote, List<PurchaseProblem>>> quote(UUID player, Track track) {
    var loaded = runtime.cache().progress(player);
    if (loaded.isEmpty()) {
      return completedFuture(Result.err(List.of(new PurchaseProblem.StillLoading())));
    }
    var progress = loaded.get();
    return wallets
        .balance(account(player))
        .thenApplyAsync(
            balance ->
                rules.validate(
                    PurchaseAttempt.next(
                        progress, track, runtime.time().instant(), balance.amount())),
            runtime.mainThread());
  }

  @Override
  public CompletableFuture<Result<Purchase, List<PurchaseProblem>>> buy(UUID player, Quote quote) {
    if (runtime.cache().progress(player).isEmpty()) {
      return completedFuture(Result.err(List.of(new PurchaseProblem.StillLoading())));
    }
    if (!buying.add(player)) {
      return completedFuture(Result.err(List.of(new PurchaseProblem.AlreadyBuying())));
    }
    CompletableFuture<Result<Recorded, List<PurchaseProblem>>> flow;
    try {
      flow =
          runtime
              .store()
              .load(player)
              .thenCompose(
                  progress ->
                      wallets
                          .balance(account(player))
                          .thenCompose(balance -> charge(player, quote, progress, balance)));
    } catch (RuntimeException e) {
      buying.remove(player);
      throw e;
    }
    return flow.whenComplete((ignored, failure) -> buying.remove(player))
        .thenApplyAsync(recorded -> finish(player, recorded), runtime.mainThread());
  }

  /** Checks the offer against the stored progress and, if it still stands, takes payment. */
  private CompletableFuture<Result<Recorded, List<PurchaseProblem>>> charge(
      UUID player, Quote offered, TrackProgress progress, Crystals balance) {
    var attempt =
        new PurchaseAttempt(
            progress, offered.track(), offered.level(), runtime.time().instant(), balance.amount());
    return switch (rules.validate(attempt)) {
      case Result.Err<Quote, List<PurchaseProblem>>(var problems) ->
          completedFuture(Result.err(problems));
      case Result.Ok<Quote, List<PurchaseProblem>>(var current) when !current.equals(offered) ->
          completedFuture(Result.err(List.of(new PurchaseProblem.QuoteChanged(offered, current))));
      case Result.Ok<Quote, List<PurchaseProblem>>(var current) ->
          wallets
              .transfer(account(player), SERVER, Crystals.of(current.cost()), reason(current))
              .thenCompose(paid -> afterPayment(player, progress, current, paid));
    };
  }

  private CompletableFuture<Result<Recorded, List<PurchaseProblem>>> afterPayment(
      UUID player, TrackProgress before, Quote quote, Result<Receipt, EconomyError> paid) {
    return switch (paid) {
      case Result.Ok<Receipt, EconomyError>(var receipt) -> record(player, before, quote, receipt);
      case Result.Err<Receipt, EconomyError>(
              EconomyError.InsufficientFunds(var _, var balance, var required)) ->
          completedFuture(
              Result.err(
                  List.of(new PurchaseProblem.CannotAfford(required.amount(), balance.amount()))));
      case Result.Err<Receipt, EconomyError>(EconomyError.ZeroAmount _) ->
          throw new IllegalStateException("a track level was priced at zero: " + quote);
      case Result.Err<Receipt, EconomyError>(EconomyError.SameAccount _) ->
          throw new IllegalStateException("a player paid themselves for " + quote);
    };
  }

  /**
   * Stores the level if the player's progress is still what was charged for. A conflicting change
   * or a failed write refunds the payment.
   */
  private CompletableFuture<Result<Recorded, List<PurchaseProblem>>> record(
      UUID player, TrackProgress before, Quote quote, Receipt receipt) {
    var after = before.purchased(quote.track(), quote.level(), runtime.time().instant());
    var purchase = new Purchase(quote, before.primary().isEmpty(), receipt.transactionId());
    return runtime
        .store()
        .update(
            player,
            current ->
                current.equals(before)
                    ? Result.<TrackProgress, TrackProgress>ok(after)
                    : Result.<TrackProgress, TrackProgress>err(current))
        .<SaveOutcome>thenApply(
            saved ->
                switch (saved) {
                  case Result.Ok<TrackProgress, TrackProgress>(var stored) -> new Saved(stored);
                  case Result.Err<TrackProgress, TrackProgress>(var current) ->
                      new Conflict(current);
                })
        .exceptionally(Failed::new)
        .thenCompose(
            outcome ->
                switch (outcome) {
                  case Saved(var stored) ->
                      completedFuture(Result.ok(new Recorded(stored, purchase)));
                  case Conflict(var current) -> {
                    runtime
                        .logger()
                        .error(
                            "Charged {} for {} (ledger #{}) but their tracks changed to {}"
                                + " meanwhile; refunding",
                            player,
                            quote,
                            receipt.transactionId(),
                            current);
                    yield refund(player, quote, receipt);
                  }
                  case Failed(var failure) -> {
                    runtime
                        .logger()
                        .error(
                            "Charged {} for {} (ledger #{}) but could not save the level;"
                                + " refunding",
                            player,
                            quote,
                            receipt.transactionId(),
                            failure);
                    yield refund(player, quote, receipt);
                  }
                });
  }

  private CompletableFuture<Result<Recorded, List<PurchaseProblem>>> refund(
      UUID player, Quote quote, Receipt charge) {
    return wallets
        .transfer(SERVER, account(player), Crystals.of(quote.cost()), refundReason(quote))
        .handle(
            (refunded, failure) -> {
              if (failure != null) {
                runtime
                    .logger()
                    .error(
                        "REFUND FAILED: {} paid {} for {} (ledger #{}) and did not get the level"
                            + " or their crystals back; refund them by hand",
                        player,
                        quote.cost(),
                        quote,
                        charge.transactionId(),
                        failure);
                throw new IllegalStateException("refund failed for " + player, failure);
              }
              return switch (refunded) {
                case Result.Ok<Receipt, EconomyError>(var receipt) -> {
                  runtime
                      .logger()
                      .warn(
                          "Refunded {} crystals to {} for {} (ledger #{})",
                          quote.cost(),
                          player,
                          quote,
                          receipt.transactionId());
                  yield Result.<Recorded, List<PurchaseProblem>>err(
                      List.of(new PurchaseProblem.NotRecorded(quote)));
                }
                case Result.Err<Receipt, EconomyError>(var error) ->
                    throw new IllegalStateException(
                        "the economy refused to refund " + player + " for " + quote + ": " + error);
              };
            });
  }

  /** On the main thread: publish a stored purchase to the cache and permissions. */
  private Result<Purchase, List<PurchaseProblem>> finish(
      UUID player, Result<Recorded, List<PurchaseProblem>> recorded) {
    return recorded.map(
        stored -> {
          runtime.changed(player, stored.progress());
          return stored.purchase();
        });
  }

  private static AccountId account(UUID player) {
    return new AccountId.Player(player);
  }

  /** A purchase that is paid for and stored. */
  private record Recorded(TrackProgress progress, Purchase purchase) {}

  /** What became of storing a paid-for level. */
  private sealed interface SaveOutcome {}

  /** Stored as {@code progress}. */
  private record Saved(TrackProgress progress) implements SaveOutcome {}

  /** Not stored: the player's progress had changed to {@code current} since it was read. */
  private record Conflict(TrackProgress current) implements SaveOutcome {}

  /** Not stored: the write failed. */
  private record Failed(Throwable failure) implements SaveOutcome {}
}
