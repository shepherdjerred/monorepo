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
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Buying track levels. The level is written only after the economy has taken payment; if it then
 * cannot be written, the payment is refunded with a compensating transfer, so a player is never
 * charged for a level they do not get. One purchase per player runs at a time.
 *
 * <p>On shutdown, {@link #shutdown} refuses new purchases and waits for running ones to finish
 * before the database closes. One window remains: if the process dies between the charge and the
 * level write (a crash or kill, not a clean stop), the ledger holds a {@code track:<id>:<level>}
 * payment with no level and no refund. The operator's remedy is {@code /perks admin set <player>
 * <track> <level>} for the paid level.
 */
public final class PurchaseService implements TrackPurchases {

  private static final AccountId SERVER = new AccountId.Server();

  private final TrackRuntime runtime;
  private final Wallets wallets;
  private final PurchaseRules rules;

  /** Each player's running purchase, completed once it has been paid and stored or refunded. */
  private final Map<UUID, CompletableFuture<Void>> buying = new ConcurrentHashMap<>();

  private volatile boolean closed;

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
   * Refuses new purchases and waits up to {@code timeout} for running ones to be paid and stored or
   * refunded. Blocks the calling thread: call only while the plugin is stopping. Returns whether
   * every purchase finished in time.
   */
  public boolean shutdown(Duration timeout) {
    closed = true;
    var running = CompletableFuture.allOf(buying.values().toArray(new CompletableFuture<?>[0]));
    try {
      running.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
      return true;
    } catch (TimeoutException e) {
      runtime
          .logger()
          .error(
              "Stopping with track purchases still running for {}; any charged without a level"
                  + " need /perks admin set",
              buying.keySet(),
              e);
      return false;
    } catch (ExecutionException e) {
      // Each purchase reports its own failure; it has finished either way.
      return true;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return false;
    }
  }

  /** Why {@code player} cannot use the tracks right now, if anything. */
  private Optional<PurchaseProblem> notReady(UUID player) {
    if (closed) {
      return Optional.of(new PurchaseProblem.ShuttingDown());
    }
    var state = runtime.cache().state(player);
    if (state.isEmpty()) {
      return Optional.of(new PurchaseProblem.StillLoading());
    }
    return switch (state.get()) {
      case LevelCache.State.Loading() -> Optional.of(new PurchaseProblem.StillLoading());
      case LevelCache.State.Failed() -> Optional.of(new PurchaseProblem.LoadFailed());
      case LevelCache.State.Loaded(var _) -> Optional.empty();
    };
  }

  /** {@code player}'s loaded progress, or why it is not usable. */
  private Result<TrackProgress, PurchaseProblem> ready(UUID player) {
    var problem = notReady(player);
    if (problem.isPresent()) {
      return Result.err(problem.get());
    }
    return runtime
        .cache()
        .progress(player)
        .<Result<TrackProgress, PurchaseProblem>>map(Result::ok)
        .orElseGet(() -> Result.err(new PurchaseProblem.StillLoading()));
  }

  /**
   * Every track's standing for {@code player}, for {@code /perks}; refused until they have loaded.
   */
  public CompletableFuture<Result<List<TrackStanding>, PurchaseProblem>> overview(UUID player) {
    return switch (ready(player)) {
      case Result.Err<TrackProgress, PurchaseProblem>(var problem) ->
          completedFuture(Result.err(problem));
      case Result.Ok<TrackProgress, PurchaseProblem>(var progress) ->
          wallets
              .balance(account(player))
              .thenApplyAsync(
                  balance ->
                      Result.ok(
                          rules.overview(progress, runtime.time().instant(), balance.amount())),
                  runtime.mainThread());
    };
  }

  @Override
  public CompletableFuture<Result<Quote, List<PurchaseProblem>>> quote(UUID player, Track track) {
    return switch (ready(player)) {
      case Result.Err<TrackProgress, PurchaseProblem>(var problem) ->
          completedFuture(Result.err(List.of(problem)));
      case Result.Ok<TrackProgress, PurchaseProblem>(var progress) ->
          wallets
              .balance(account(player))
              .thenApplyAsync(
                  balance ->
                      rules.validate(
                          PurchaseAttempt.next(
                              progress, track, runtime.time().instant(), balance.amount())),
                  runtime.mainThread());
    };
  }

  @Override
  public CompletableFuture<Result<Purchase, List<PurchaseProblem>>> buy(UUID player, Quote quote) {
    if (ready(player) instanceof Result.Err<TrackProgress, PurchaseProblem>(var problem)) {
      return completedFuture(Result.err(List.of(problem)));
    }
    var done = new CompletableFuture<Void>();
    if (buying.putIfAbsent(player, done) != null) {
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
      finished(player, done);
      throw e;
    }
    return flow.whenComplete((ignored, failure) -> finished(player, done))
        .thenApplyAsync(recorded -> finish(player, recorded), runtime.mainThread());
  }

  /** Frees {@code player} to buy again and lets {@link #shutdown} see the purchase is over. */
  private void finished(UUID player, CompletableFuture<Void> done) {
    buying.remove(player, done);
    done.complete(null);
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
