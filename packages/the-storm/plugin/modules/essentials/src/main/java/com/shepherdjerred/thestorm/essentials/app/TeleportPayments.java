package com.shepherdjerred.thestorm.essentials.app;

import static java.util.concurrent.CompletableFuture.completedFuture;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.KeyedTransfer;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.essentials.app.store.TeleportAttemptStore;
import com.shepherdjerred.thestorm.essentials.app.store.TeleportUsageStore;
import com.shepherdjerred.thestorm.essentials.app.store.TeleportUsageStore.Confirmation;
import com.shepherdjerred.thestorm.essentials.domain.teleport.Exemptions;
import com.shepherdjerred.thestorm.essentials.domain.teleport.Quote;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPricer;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPricing;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportUsage;
import java.time.InstantSource;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Prices and charges teleports with a durable, keyed obligation. Recovery refunds a committed
 * charge whose arrival was not durably confirmed.
 *
 * <ol>
 *   <li>{@link #charge} records the attempt, then moves crystals to the server account with its
 *       stable ledger key;
 *   <li>once the player has arrived, {@link #confirm} records usage and clears the attempt;
 *   <li>if the teleport fails, {@link #refund} returns crystals with a stable refund key and clears
 *       the attempt.
 * </ol>
 *
 * <p>Futures complete off the main thread. Callers must not run two teleports for the same player
 * at once; the Paper adapter holds one lock per player from quote to arrival.
 */
public final class TeleportPayments {

  private final TeleportPricer pricer;
  private final TeleportUsageStore usage;
  private final TeleportAttemptStore attempts;
  private final Wallets wallets;
  private final InstantSource time;
  private final CompletableFuture<Void> loaded;

  /** Persistence ports used by a paid teleport. */
  public record Stores(TeleportUsageStore usage, TeleportAttemptStore attempts) {}

  /** The quote and its durable attempt, if payment was needed. */
  public record Charge(UUID id, Quote quote, Optional<TeleportAttempt> attempt) {}

  public TeleportPayments(
      TeleportPricer pricer, Stores stores, Wallets wallets, InstantSource time) {
    this.pricer = pricer;
    this.usage = stores.usage();
    this.attempts = stores.attempts();
    this.wallets = wallets;
    this.time = time;
    this.loaded = recoverPending();
  }

  /** Completes when uncertain charges from an earlier process have been reconciled. */
  public CompletableFuture<Void> loaded() {
    return loaded;
  }

  /** What a teleport would cost now, without charging or recording anything. */
  public CompletableFuture<Result<Quote, TeleportRefusal>> quote(
      UUID payer, TeleportKind kind, Exemptions exemptions) {
    return loaded.thenCompose(
        ready ->
            usage
                .find(payer, time.instant().minus(pricer.pricing().window()))
                .thenApply(
                    found ->
                        pricer
                            .quote(kind, found, exemptions, time.instant())
                            .mapError(TeleportRefusal.Cooldown::new)));
  }

  /** Re-quotes, records the obligation, then takes crystals. Records no usage. */
  public CompletableFuture<Result<Charge, TeleportRefusal>> charge(
      UUID payer, TeleportKind kind, Exemptions exemptions) {
    return quote(payer, kind, exemptions)
        .thenCompose(
            quoted ->
                switch (quoted) {
                  case Result.Err<Quote, TeleportRefusal>(var refusal) ->
                      completedFuture(Result.err(refusal));
                  case Result.Ok<Quote, TeleportRefusal>(var quote) -> take(payer, quote);
                });
  }

  /** The player arrived: records usage before clearing the recovery obligation. */
  public CompletableFuture<Void> confirm(UUID payer, Charge charged) {
    var quote = charged.quote();
    var now = time.instant();
    return usage.confirm(
        new Confirmation(
            payer,
            charged.id(),
            quote.kind(),
            quote.next().deliveredAt(now),
            now.minus(pricer.pricing().window().multipliedBy(2))));
  }

  public TeleportPricing pricing() {
    return pricer.pricing();
  }

  public CompletableFuture<TeleportUsage> history(UUID player) {
    return loaded
        .thenCompose(ready -> usage.find(player, time.instant().minus(pricer.pricing().window())))
        .thenApply(found -> found.orElse(TeleportUsage.EMPTY));
  }

  public Quote preview(
      TeleportKind kind, TeleportUsage history, Exemptions exemptions, java.time.Instant now) {
    return pricer.preview(kind, history, exemptions, now);
  }

  /** The teleport could not happen after {@link #charge}: returns crystals once. */
  public CompletableFuture<Void> refund(Charge charged) {
    return charged.attempt().isPresent()
        ? refund(charged.attempt().orElseThrow())
        : completedFuture(null);
  }

  private CompletableFuture<Result<Charge, TeleportRefusal>> take(UUID payer, Quote quote) {
    if (quote.cost() == 0) {
      return completedFuture(Result.ok(new Charge(UUID.randomUUID(), quote, Optional.empty())));
    }
    var attempt = new TeleportAttempt(UUID.randomUUID(), payer, quote.kind(), quote.cost());
    return attempts
        .insert(attempt)
        .thenCompose(
            saved ->
                wallets
                    .transferOnce(
                        new KeyedTransfer(
                            attempt.id(),
                            new AccountId.Player(payer),
                            new AccountId.Server(),
                            Crystals.of(quote.cost()),
                            "teleport:" + quote.kind().id()))
                    .thenCompose(
                        transfer ->
                            switch (transfer) {
                              case Result.Ok<Receipt, EconomyError> _ ->
                                  completedFuture(
                                      Result.ok(
                                          new Charge(attempt.id(), quote, Optional.of(attempt))));
                              case Result.Err<Receipt, EconomyError>(var error) ->
                                  attempts
                                      .delete(attempt.id())
                                      .thenApply(done -> Result.err(refusal(error)));
                            }));
  }

  private CompletableFuture<Void> recoverPending() {
    return attempts
        .pending()
        .thenCompose(
            pending ->
                CompletableFuture.allOf(
                    pending.stream().map(this::reconcile).toArray(CompletableFuture[]::new)));
  }

  private CompletableFuture<Void> reconcile(TeleportAttempt attempt) {
    return wallets
        .receiptFor(attempt.id())
        .thenCompose(
            receipt -> receipt.isPresent() ? refund(attempt) : attempts.delete(attempt.id()));
  }

  private CompletableFuture<Void> refund(TeleportAttempt attempt) {
    return wallets
        .transferOnce(
            new KeyedTransfer(
                attempt.refundKey(),
                new AccountId.Server(),
                new AccountId.Player(attempt.payer()),
                Crystals.of(attempt.cost()),
                "teleport:refund:" + attempt.kind().id()))
        .thenCompose(
            result -> {
              requireOk(result);
              return attempts.delete(attempt.id());
            });
  }

  private static TeleportRefusal refusal(EconomyError error) {
    return switch (error) {
      case EconomyError.InsufficientFunds(var _, var balance, var required) ->
          new TeleportRefusal.CannotAfford(balance.amount(), required.amount());
      case EconomyError.ZeroAmount _ ->
          throw new IllegalStateException("teleports never charge zero crystals");
      case EconomyError.SameAccount _ ->
          throw new IllegalStateException("a player is never the server account");
    };
  }

  private static void requireOk(Result<Receipt, EconomyError> result) {
    if (result instanceof Result.Err<Receipt, EconomyError>(var error)) {
      throw new IllegalStateException("the server account refused a refund: " + error);
    }
  }
}
