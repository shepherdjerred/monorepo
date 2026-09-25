package com.shepherdjerred.thestorm.essentials.app;

import static java.util.concurrent.CompletableFuture.completedFuture;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.essentials.app.store.TeleportUsageStore;
import com.shepherdjerred.thestorm.essentials.domain.teleport.Exemptions;
import com.shepherdjerred.thestorm.essentials.domain.teleport.Quote;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPricer;
import java.time.InstantSource;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Prices and charges teleports in three steps, so a teleport that does not happen never costs the
 * player anything:
 *
 * <ol>
 *   <li>{@link #charge} moves the crystals from the payer to the server account (reason {@code
 *       teleport:<kind>}) and records nothing else;
 *   <li>once the player has arrived, {@link #confirm} records the usage, which raises the
 *       multiplier and starts the cooldown;
 *   <li>if the teleport fails after the charge, {@link #refund} returns the crystals and nothing is
 *       recorded.
 * </ol>
 *
 * <p>Futures complete off the main thread. Callers must not run two teleports for the same player
 * at once; the Paper adapter holds one lock per player from quote to arrival.
 */
public final class TeleportPayments {

  private final TeleportPricer pricer;
  private final TeleportUsageStore usage;
  private final Wallets wallets;
  private final InstantSource time;

  public TeleportPayments(
      TeleportPricer pricer, TeleportUsageStore usage, Wallets wallets, InstantSource time) {
    this.pricer = pricer;
    this.usage = usage;
    this.wallets = wallets;
    this.time = time;
  }

  /** What a teleport would cost now, without charging or recording anything. */
  public CompletableFuture<Result<Quote, TeleportRefusal>> quote(
      UUID payer, TeleportKind kind, Exemptions exemptions) {
    return usage
        .find(payer, kind)
        .thenApply(
            found ->
                pricer
                    .quote(kind, found, exemptions, time.instant())
                    .mapError(TeleportRefusal.Cooldown::new));
  }

  /** Re-quotes at the current time and takes the crystals. Records no usage. */
  public CompletableFuture<Result<Quote, TeleportRefusal>> charge(
      UUID payer, TeleportKind kind, Exemptions exemptions) {
    return quote(payer, kind, exemptions)
        .thenCompose(
            quoted ->
                switch (quoted) {
                  case Result.Err<Quote, TeleportRefusal> refused -> completedFuture(refused);
                  case Result.Ok<Quote, TeleportRefusal>(var quote) -> take(payer, quote);
                });
  }

  /** The player arrived: records the usage from {@code quote}. */
  public CompletableFuture<Void> confirm(UUID payer, Quote quote) {
    return usage.save(payer, quote.kind(), quote.next());
  }

  /** The teleport could not happen after {@link #charge}: returns the crystals. */
  public CompletableFuture<Void> refund(UUID payer, Quote quote) {
    if (quote.cost() == 0) {
      return completedFuture(null);
    }
    return wallets
        .transfer(
            new AccountId.Server(),
            new AccountId.Player(payer),
            Crystals.of(quote.cost()),
            "teleport:refund:" + quote.kind().id())
        .thenAccept(TeleportPayments::requireOk);
  }

  private CompletableFuture<Result<Quote, TeleportRefusal>> take(UUID payer, Quote quote) {
    if (quote.cost() == 0) {
      return completedFuture(Result.ok(quote));
    }
    return wallets
        .transfer(
            new AccountId.Player(payer),
            new AccountId.Server(),
            Crystals.of(quote.cost()),
            "teleport:" + quote.kind().id())
        .thenApply(
            transfer ->
                switch (transfer) {
                  case Result.Ok<Receipt, EconomyError> _ -> Result.ok(quote);
                  case Result.Err<Receipt, EconomyError>(var error) -> Result.err(refusal(error));
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
